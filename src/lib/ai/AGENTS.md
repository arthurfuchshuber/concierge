# AI rules
- AI decision cards (`ai_human_escalations.context_snapshot.decision`) may carry whitelisted actions (`DECISION_ACTIONS`); the proactive copilot (`proactive-decisions.server.ts`) only proposes them, the action runs on the team's click in `answerEscalation` and `reopenEscalationDecision` undoes it, so the AI never changes operations on its own.
