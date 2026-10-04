"""All account SQL (tables from migrations 003 and 004). Raw asyncpg, no ORM.

Handles and emails are compared with lower() so this works whether or not the column type is
citext. User ids are canonicalised with `uuid_str` before use, which also keeps the
`friendships.user_a < user_b` ordering consistent with Postgres's uuid ordering.
"""

import uuid
from datetime import datetime, timedelta
from typing import Any

import asyncpg

from munch.accounts.errors import AccountError
from munch.accounts.tokens import (
    hash_login_code,
    login_code_matches,
    new_login_code,
    new_session_token,
)
from munch.models import (
    CityStamp,
    Friendship,
    FriendshipStatus,
    FriendsResponse,
    MyProfile,
    Preferences,
    PublicUser,
    RoomInvite,
)

type Pool = asyncpg.Pool[asyncpg.Record]

USER_COLS = "u.id, u.handle, u.display_name, u.email, u.avatar_url, u.share_likes"


def uuid_str(value: str) -> str:
    """Canonical lowercase uuid, or NOT_FOUND for anything that isn't one."""
    try:
        return str(uuid.UUID(value))
    except ValueError as e:
        raise AccountError("NOT_FOUND", "No such user") from e


def _profile(r: asyncpg.Record) -> MyProfile:
    return MyProfile(
        id=str(r["id"]),
        handle=r["handle"],
        display_name=r["display_name"],
        email=r["email"],
        avatar_url=r["avatar_url"],
        share_likes=r["share_likes"],
    )


def _public(r: asyncpg.Record, prefix: str = "") -> PublicUser:
    return PublicUser(
        id=str(r[f"{prefix}id"]),
        handle=r[f"{prefix}handle"],
        display_name=r[f"{prefix}display_name"],
        avatar_url=r[f"{prefix}avatar_url"],
    )


# --- Users and sign-in ----------------------------------------------------


async def sign_in_with_identity(
    pool: Pool,
    *,
    provider: str,
    subject: str,
    email: str | None,
    display_name: str,
    avatar_url: str | None,
) -> tuple[MyProfile, bool]:
    """Find or create the user behind a login. Returns (profile, created_now).

    A new login method joins an existing account only through a verified email, so signing in
    with Google and with an emailed code (same address) gives one account.

    `avatar_url` is the login's own picture (Google's). It becomes the default picture of any
    account that has none, so an account made with an email code picks up the Google picture
    the first time it signs in with Google. A picture the user uploaded is never replaced.
    """
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            f"""SELECT {USER_COLS} FROM auth_identities i JOIN users u ON u.id = i.user_id
                WHERE i.provider = $1 AND i.subject = $2""",
            provider,
            subject,
        )
        if row is not None:
            await conn.execute(
                "UPDATE auth_identities SET last_login_at = now()"
                " WHERE provider = $1 AND subject = $2",
                provider,
                subject,
            )
            return _profile(await _default_avatar(conn, row, avatar_url)), False

        created = False
        if email is not None:
            row = await conn.fetchrow(
                f"SELECT {USER_COLS} FROM users u WHERE lower(u.email) = lower($1)", email
            )
        if row is None:
            row = await conn.fetchrow(
                f"""INSERT INTO users AS u (display_name, email, avatar_url)
                    VALUES ($1, $2, $3) RETURNING {USER_COLS}""",
                display_name[:24] or "Muncher",
                email,
                avatar_url,
            )
            created = True
        assert row is not None
        await conn.execute(
            """INSERT INTO auth_identities (provider, subject, user_id, last_login_at)
               VALUES ($1, $2, $3, now())""",
            provider,
            subject,
            row["id"],
        )
        return _profile(await _default_avatar(conn, row, avatar_url)), created


async def _default_avatar(conn: Any, row: asyncpg.Record, avatar_url: str | None) -> asyncpg.Record:
    """Give a picture-less account this login's picture. Returns the (maybe updated) row."""
    if avatar_url is None or row["avatar_url"] is not None:
        return row
    updated: asyncpg.Record = await conn.fetchrow(
        f"UPDATE users AS u SET avatar_url = $2 WHERE u.id = $1 RETURNING {USER_COLS}",
        row["id"],
        avatar_url,
    )
    return updated


async def get_profile(pool: Pool, user_id: str) -> MyProfile:
    row = await pool.fetchrow(f"SELECT {USER_COLS} FROM users u WHERE u.id = $1", user_id)
    if row is None:
        raise AccountError("UNAUTHORIZED", "Account no longer exists")
    return _profile(row)


async def update_profile(
    pool: Pool,
    user_id: str,
    *,
    handle: str | None,
    display_name: str | None,
    share_likes: bool | None,
) -> MyProfile:
    try:
        row = await pool.fetchrow(
            f"""UPDATE users AS u SET
                  handle = COALESCE($2, u.handle),
                  display_name = COALESCE($3, u.display_name),
                  share_likes = COALESCE($4, u.share_likes)
                WHERE u.id = $1 RETURNING {USER_COLS}""",
            user_id,
            handle,
            display_name,
            share_likes,
        )
    except asyncpg.UniqueViolationError as e:
        raise AccountError("HANDLE_TAKEN", f"@{handle} is taken") from e
    if row is None:
        raise AccountError("UNAUTHORIZED", "Account no longer exists")
    return _profile(row)


async def get_public_user(pool: Pool, user_id: str) -> PublicUser | None:
    row = await pool.fetchrow(
        "SELECT id, handle, display_name, avatar_url FROM users WHERE id = $1", uuid_str(user_id)
    )
    return _public(row) if row else None


async def find_by_handle(pool: Pool, handle: str) -> PublicUser | None:
    row = await pool.fetchrow(
        "SELECT id, handle, display_name, avatar_url FROM users WHERE lower(handle) = lower($1)",
        handle,
    )
    return _public(row) if row else None


# --- Profile pictures -----------------------------------------------------


async def set_avatar(pool: Pool, user_id: str, content_type: str, data: bytes) -> MyProfile:
    """Store the picture and point avatar_url at it. The ?v= changes on every upload, so
    phones and browsers fetch the new picture instead of showing a cached old one."""
    async with pool.acquire() as conn, conn.transaction():
        updated_at = await conn.fetchval(
            """INSERT INTO user_avatars (user_id, content_type, data) VALUES ($1, $2, $3)
               ON CONFLICT (user_id) DO UPDATE SET content_type = EXCLUDED.content_type,
                 data = EXCLUDED.data, updated_at = now()
               RETURNING updated_at""",
            user_id,
            content_type,
            data,
        )
        version = int(updated_at.timestamp() * 1000)
        row = await conn.fetchrow(
            f"UPDATE users AS u SET avatar_url = $2 WHERE u.id = $1 RETURNING {USER_COLS}",
            user_id,
            f"/api/users/{user_id}/avatar?v={version}",
        )
    if row is None:
        raise AccountError("UNAUTHORIZED", "Account no longer exists")
    return _profile(row)


async def get_avatar(pool: Pool, user_id: str) -> tuple[str, bytes] | None:
    row = await pool.fetchrow(
        "SELECT content_type, data FROM user_avatars WHERE user_id = $1", uuid_str(user_id)
    )
    return (row["content_type"], bytes(row["data"])) if row else None


async def remove_avatar(pool: Pool, user_id: str) -> MyProfile:
    """Remove the uploaded picture (and a Google one): back to initials."""
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("DELETE FROM user_avatars WHERE user_id = $1", user_id)
        row = await conn.fetchrow(
            f"UPDATE users AS u SET avatar_url = NULL WHERE u.id = $1 RETURNING {USER_COLS}",
            user_id,
        )
    if row is None:
        raise AccountError("UNAUTHORIZED", "Account no longer exists")
    return _profile(row)


# --- Sessions -------------------------------------------------------------


async def create_session(pool: Pool, user_id: str, ttl: timedelta) -> str:
    token, token_hash = new_session_token()
    await pool.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3)",
        token_hash,
        user_id,
        ttl,
    )
    return token


async def session_user_id(pool: Pool, token_hash: bytes) -> str | None:
    user_id = await pool.fetchval(
        """SELECT user_id FROM sessions
           WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()""",
        token_hash,
    )
    return str(user_id) if user_id else None


async def delete_session(pool: Pool, token_hash: bytes) -> None:
    """Log out."""
    await pool.execute("DELETE FROM sessions WHERE token_hash = $1", token_hash)


# --- Email login codes ----------------------------------------------------


async def create_login_code(pool: Pool, email: str, ttl: timedelta, per_hour: int) -> str:
    recent = await pool.fetchval(
        """SELECT count(*) FROM email_login_codes
           WHERE lower(email) = lower($1) AND created_at > now() - interval '1 hour'""",
        email,
    )
    if recent >= per_hour:
        raise AccountError("RATE_LIMITED", "Too many codes requested; try again later")
    code = new_login_code()
    await pool.execute(
        "INSERT INTO email_login_codes (email, code_hash, expires_at) VALUES ($1, $2, now() + $3)",
        email,
        hash_login_code(email, code),
        ttl,
    )
    return code


async def verify_login_code(pool: Pool, email: str, code: str, max_attempts: int) -> bool:
    """Check the newest live code for this email. Each wrong guess uses up an attempt."""
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """SELECT id, code_hash, attempts FROM email_login_codes
               WHERE lower(email) = lower($1) AND consumed_at IS NULL AND expires_at > now()
               ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
            email,
        )
        if row is None or row["attempts"] >= max_attempts:
            return False
        if login_code_matches(email, code, row["code_hash"]):
            await conn.execute(
                "UPDATE email_login_codes SET consumed_at = now() WHERE id = $1", row["id"]
            )
            return True
        await conn.execute(
            "UPDATE email_login_codes SET attempts = attempts + 1 WHERE id = $1", row["id"]
        )
        return False


# --- Preferences ----------------------------------------------------------


async def list_stamps(pool: Pool, user_id: str) -> list[CityStamp]:
    rows = await pool.fetch(
        """SELECT city, first_visited_at FROM user_city_stamps
           WHERE user_id = $1 ORDER BY first_visited_at, city""",
        user_id,
    )
    return [CityStamp(city=r["city"], first_visited_at=r["first_visited_at"]) for r in rows]


async def add_stamp(pool: Pool, user_id: str, city: str) -> list[CityStamp]:
    """Give the user this city's stamp (a repeat visit changes nothing). Returns them all."""
    await pool.execute(
        """INSERT INTO user_city_stamps (user_id, city) VALUES ($1, $2)
           ON CONFLICT (user_id, city) DO NOTHING""",
        user_id,
        city,
    )
    return await list_stamps(pool, user_id)


async def get_preferences(pool: Pool, user_id: str) -> Preferences:
    row = await pool.fetchrow(
        """SELECT price_levels, exclude_types, favorite_types, dietary, max_radius_m
           FROM user_preferences WHERE user_id = $1""",
        user_id,
    )
    if row is None:
        return Preferences()
    return Preferences(
        price_levels=row["price_levels"],
        exclude_types=row["exclude_types"],
        favorite_types=row["favorite_types"],
        dietary=row["dietary"],
        max_radius_m=row["max_radius_m"],
    )


async def put_preferences(pool: Pool, user_id: str, prefs: Preferences) -> Preferences:
    await pool.execute(
        """INSERT INTO user_preferences
             (user_id, price_levels, exclude_types, favorite_types, dietary, max_radius_m)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id) DO UPDATE SET
             price_levels = EXCLUDED.price_levels,
             exclude_types = EXCLUDED.exclude_types,
             favorite_types = EXCLUDED.favorite_types,
             dietary = EXCLUDED.dietary,
             max_radius_m = EXCLUDED.max_radius_m,
             updated_at = now()""",
        user_id,
        sorted(set(prefs.price_levels)) if prefs.price_levels else None,
        prefs.exclude_types,
        prefs.favorite_types,
        list(prefs.dietary),
        prefs.max_radius_m,
    )
    return await get_preferences(pool, user_id)


# --- Friends --------------------------------------------------------------


def _pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


async def _blocked(conn: Any, a: str, b: str) -> bool:
    return bool(
        await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2)
                                                  OR (blocker_id = $2 AND blocked_id = $1))""",
            a,
            b,
        )
    )


async def request_friend(pool: Pool, me: str, other: str) -> FriendshipStatus:
    """Send a request, or accept theirs if they already asked me."""
    other = uuid_str(other)
    if other == me:
        raise AccountError("BAD_STATE", "You can't add yourself")
    a, b = _pair(me, other)
    async with pool.acquire() as conn, conn.transaction():
        exists = await conn.fetchval("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)", other)
        if not exists or await _blocked(conn, me, other):
            raise AccountError("NOT_FOUND", "No such user")
        row = await conn.fetchrow(
            """SELECT status, requested_by FROM friendships
               WHERE user_a = $1 AND user_b = $2 FOR UPDATE""",
            a,
            b,
        )
        if row is None:
            await conn.execute(
                """INSERT INTO friendships (user_a, user_b, status, requested_by)
                   VALUES ($1, $2, 'pending', $3)""",
                a,
                b,
                me,
            )
            return "outgoing"
        if row["status"] == "accepted":
            return "friends"
        if str(row["requested_by"]) == me:
            return "outgoing"
        await conn.execute(
            """UPDATE friendships SET status = 'accepted', accepted_at = now()
               WHERE user_a = $1 AND user_b = $2""",
            a,
            b,
        )
        return "friends"


async def accept_friend(pool: Pool, me: str, other: str) -> None:
    other = uuid_str(other)
    a, b = _pair(me, other)
    updated = await pool.fetchval(
        """UPDATE friendships SET status = 'accepted', accepted_at = now()
           WHERE user_a = $1 AND user_b = $2 AND status = 'pending' AND requested_by = $3
           RETURNING 1""",
        a,
        b,
        other,
    )
    if updated is None:
        raise AccountError("NOT_FOUND", "No friend request from that user")


async def remove_friend(pool: Pool, me: str, other: str) -> None:
    """Unfriend, decline their request, or cancel mine: all the same row."""
    a, b = _pair(me, uuid_str(other))
    await pool.execute("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2", a, b)


async def list_friendships(pool: Pool, me: str) -> FriendsResponse:
    rows = await pool.fetch(
        """SELECT f.status, f.requested_by, f.created_at, f.accepted_at,
                  u.id, u.handle, u.display_name, u.avatar_url
           FROM friendships f
           JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
           WHERE f.user_a = $1 OR f.user_b = $1
           ORDER BY lower(u.display_name)""",
        me,
    )
    out = FriendsResponse(friends=[], incoming=[], outgoing=[])
    for r in rows:
        user = _public(r)
        if r["status"] == "accepted":
            out.friends.append(Friendship(user=user, status="friends", since=r["accepted_at"]))
        elif str(r["requested_by"]) == me:
            out.outgoing.append(Friendship(user=user, status="outgoing", since=r["created_at"]))
        else:
            out.incoming.append(Friendship(user=user, status="incoming", since=r["created_at"]))
    return out


async def friend_ids_among(pool: Pool, me: str, candidates: list[str]) -> set[str]:
    rows = await pool.fetch(
        """SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS friend
           FROM friendships
           WHERE status = 'accepted'
             AND ((user_a = $1 AND user_b = ANY($2::uuid[]))
               OR (user_b = $1 AND user_a = ANY($2::uuid[])))""",
        me,
        candidates,
    )
    return {str(r["friend"]) for r in rows}


# --- Room invites ---------------------------------------------------------


async def create_invites(
    pool: Pool,
    *,
    room_id: str,
    room_code: str,
    from_user: PublicUser,
    to_user_ids: list[str],
    expires_at: datetime,
) -> list[tuple[str, RoomInvite]]:
    """Invite the given users who are my friends. Returns (to_user_id, invite) per new invite;
    friends who already have a pending invite to this room are skipped."""
    wanted = list(dict.fromkeys(uuid_str(u) for u in to_user_ids))
    friends = await friend_ids_among(pool, from_user.id, wanted)
    targets = [u for u in wanted if u in friends]
    if not targets:
        return []
    rows = await pool.fetch(
        """INSERT INTO room_invites (room_id, room_code, from_user_id, to_user_id, expires_at)
           SELECT $1, $2, $3, t, $5 FROM unnest($4::uuid[]) AS t
           ON CONFLICT (room_id, to_user_id) WHERE status = 'pending' DO NOTHING
           RETURNING id, to_user_id, created_at, expires_at""",
        room_id,
        room_code,
        from_user.id,
        targets,
        expires_at,
    )
    return [
        (
            str(r["to_user_id"]),
            RoomInvite(
                id=str(r["id"]),
                room_code=room_code,
                from_user=from_user,
                created_at=r["created_at"],
                expires_at=r["expires_at"],
            ),
        )
        for r in rows
    ]


async def pending_invites(pool: Pool, user_id: str) -> list[RoomInvite]:
    rows = await pool.fetch(
        """SELECT i.id AS invite_id, i.room_code, i.created_at, i.expires_at,
                  u.id, u.handle, u.display_name, u.avatar_url
           FROM room_invites i JOIN users u ON u.id = i.from_user_id
           WHERE i.to_user_id = $1 AND i.status = 'pending' AND i.expires_at > now()
           ORDER BY i.created_at DESC""",
        user_id,
    )
    return [
        RoomInvite(
            id=str(r["invite_id"]),
            room_code=r["room_code"],
            from_user=_public(r),
            created_at=r["created_at"],
            expires_at=r["expires_at"],
        )
        for r in rows
    ]


async def get_pending_invite(pool: Pool, invite_id: str, user_id: str) -> str:
    """The room code of one of my live invites, or NOT_FOUND."""
    try:
        invite_id = str(uuid.UUID(invite_id))
    except ValueError as e:
        raise AccountError("NOT_FOUND", "Invite not found or expired") from e
    code = await pool.fetchval(
        """SELECT room_code FROM room_invites
           WHERE id = $1 AND to_user_id = $2 AND status = 'pending' AND expires_at > now()""",
        invite_id,
        user_id,
    )
    if code is None:
        raise AccountError("NOT_FOUND", "Invite not found or expired")
    return str(code)


async def set_invite_status(pool: Pool, invite_id: str, status: str) -> None:
    await pool.execute(
        "UPDATE room_invites SET status = $2, responded_at = now() WHERE id = $1",
        invite_id,
        status,
    )


async def expire_room_invites(pool: Pool, room_id: str) -> None:
    """The room started or closed: nobody can join it any more."""
    await pool.execute(
        "UPDATE room_invites SET status = 'expired' WHERE room_id = $1 AND status = 'pending'",
        room_id,
    )


# --- Swipes ---------------------------------------------------------------


async def record_swipe(pool: Pool, user_id: str, restaurant_id: str, liked: bool) -> None:
    await pool.execute(
        "INSERT INTO swipes (user_id, restaurant_id, liked) VALUES ($1, $2, $3)",
        user_id,
        restaurant_id,
        liked,
    )
