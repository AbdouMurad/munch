"""`/ws/me?token=<sessionToken>`: a signed-in user's live channel (invites arrive here).

Open it whenever the app is in the foreground and signed in. The server sends; the
client may only send `ping` and gets `pong`. Bad or missing token closes with 4401.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from munch.accounts.deps import user_for_token
from munch.accounts.errors import AccountError
from munch.models import ErrorBody, ErrorMessage, PingMessage, PongMessage, client_message_adapter
from munch.realtime.ws import UNAUTHORIZED_CLOSE
from munch.state import StateDep

router = APIRouter()


@router.websocket("/ws/me")
async def user_socket(ws: WebSocket, state: StateDep, token: str = "") -> None:
    await ws.accept()
    try:
        user = await user_for_token(state, token) if token else None
    except AccountError:  # no DB configured
        user = None
    if user is None:
        await ws.close(code=UNAUTHORIZED_CLOSE)
        return

    state.user_hub.add(user.id, ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = client_message_adapter.validate_json(raw)
            except ValidationError:
                msg = None
            if isinstance(msg, PingMessage):
                await state.user_hub.send(ws, PongMessage())
            else:
                err = ErrorBody(code="VALIDATION_ERROR", message="Only ping is accepted here")
                await state.user_hub.send(ws, ErrorMessage(payload=err))
    except WebSocketDisconnect:
        pass
    finally:
        state.user_hub.remove(user.id, ws)
