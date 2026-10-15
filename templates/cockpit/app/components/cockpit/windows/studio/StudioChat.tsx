/**
 * FA-19172: the studio's Agent chat (card-studio.js chatOpen / chatSend / chatPoll / chatRender / chatPlan), rendered natively.
 * STUB in the shell: the Agent button opens the chat layer; ChatLayer is the dialog.
 */
import { useStudio } from "./api";

export function AgentButton() {
  const st = useStudio();
  return (
    <button type="button" className="cp-btn st-agent" data-k="agent" aria-haspopup="dialog" aria-expanded={st.layer?.kind === "chat"} onClick={() => st.open({ kind: "chat" })}>
      <span aria-hidden="true">💬</span> Agent
    </button>
  );
}

export function ChatLayer() {
  return null;
}
