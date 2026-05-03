"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Message {
  id: string;
  content: string;
  messageIndex: number;
  createdAt: string;
  sender: { id: string; name: string | null };
}

interface SystemAction {
  id: string;
  actionType: string;
  initiatorId: string;
  payload: Record<string, unknown>;
  acceptedAt: string | null;
  createdAt: string;
}

interface Props {
  match: {
    id: string;
    status: string;
    activityCategory: string;
    messages: Message[];
    systemActions: SystemAction[];
    finalizedPlan: {
      locationName: string;
      scheduledAt: string;
      userAArrivedAt: string | null;
      userBArrivedAt: string | null;
    } | null;
  };
  currentUserId: string;
  isUserA: boolean;
  otherName: string;
}

const MAX_MESSAGES = 5;

export default function CoordinationPanel({ match, currentUserId, isUserA, otherName }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState(match.messages);
  const [actions, setActions] = useState(match.systemActions);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [proposedTime, setProposedTime] = useState("");
  const [proposedLocation, setProposedLocation] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messageCount = messages.length;
  const messagesExhausted = messageCount >= MAX_MESSAGES;
  const isConfirmed = match.status === "CONFIRMED" || match.status === "DATE_ACTIVE";
  const isCompleted = match.status === "COMPLETED";
  const canSendMessage = !messagesExhausted && !isConfirmed && !isCompleted;

  const myArrivedAt = isUserA ? match.finalizedPlan?.userAArrivedAt : match.finalizedPlan?.userBArrivedAt;
  const hasArrived = !!myArrivedAt;

  const pendingTimeProposal = actions.find(
    (a) => a.actionType === "PROPOSE_TIME" && !a.acceptedAt
  );
  const acceptedTime = actions.find(
    (a) => a.actionType === "ACCEPT_TIME" && a.acceptedAt
  );
  const pendingLocationProposal = actions.find(
    (a) => a.actionType === "PROPOSE_LOCATION" && !a.acceptedAt
  );
  const acceptedLocation = actions.find(
    (a) => a.actionType === "ACCEPT_LOCATION" && a.acceptedAt
  );
  const canConfirm = acceptedTime && acceptedLocation && !isConfirmed;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, actions]);

  async function sendMessage() {
    if (!input.trim() || sending || !canSendMessage) return;
    setSending(true);
    const res = await fetch(`/api/matches/${match.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input.trim() }),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
      setInput("");
    }
    setSending(false);
  }

  async function doAction(actionType: string, payload: Record<string, unknown> = {}, targetId?: string) {
    const res = await fetch(`/api/matches/${match.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionType, payload, targetActionId: targetId }),
    });
    if (res.ok) {
      if (actionType === "CONFIRM_PLAN" || actionType === "CANCEL" || actionType === "ARRIVED") {
        router.refresh();
      } else {
        const action = await res.json();
        setActions((prev) => [...prev.filter((a) => a.id !== action.id), action]);
      }
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* System actions displayed in thread */}
        {[...messages, ...actions].sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ).map((item) => {
          if ("messageIndex" in item) {
            // Message
            const msg = item as Message;
            const isMine = msg.sender.id === currentUserId;
            return (
              <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                  isMine
                    ? "bg-brand-600 text-white rounded-br-sm"
                    : "bg-white border border-stone-200 text-stone-800 rounded-bl-sm"
                }`}>
                  {msg.content}
                  <div className={`text-xs mt-1 ${isMine ? "text-brand-200" : "text-stone-400"}`}>
                    msg {msg.messageIndex}/{MAX_MESSAGES}
                  </div>
                </div>
              </div>
            );
          } else {
            // System action
            const action = item as SystemAction;
            return <SystemActionBubble key={action.id} action={action} currentUserId={currentUserId} otherName={otherName} onAccept={doAction} />;
          }
        })}

        {/* Arrived status */}
        {match.status === "DATE_ACTIVE" && (
          <div className="text-center">
            {hasArrived ? (
              <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full">You&apos;ve checked in ✓</span>
            ) : (
              <button onClick={() => doAction("ARRIVED")} className="bg-green-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors">
                I&apos;ve arrived ✓
              </button>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* System action bar */}
      {!isCompleted && (
        <div className="border-t border-stone-100 px-4 pt-3 pb-2 bg-white">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {/* Time proposal */}
            {!acceptedTime && !pendingTimeProposal && (
              <ActionChip onClick={() => setShowTimePicker(true)} label="📅 Choose time" />
            )}
            {pendingTimeProposal && pendingTimeProposal.initiatorId !== currentUserId && (
              <ActionChip
                onClick={() => doAction("ACCEPT_TIME", {}, pendingTimeProposal.id)}
                label={`✓ Accept time: ${new Date((pendingTimeProposal.payload as { proposedDatetime?: string }).proposedDatetime ?? "").toLocaleDateString()}`}
                accent
              />
            )}

            {/* Location proposal */}
            {!acceptedLocation && !pendingLocationProposal && (
              <ActionChip onClick={() => setShowLocationPicker(true)} label="📍 Select location" />
            )}
            {pendingLocationProposal && pendingLocationProposal.initiatorId !== currentUserId && (
              <ActionChip
                onClick={() => doAction("ACCEPT_LOCATION", {}, pendingLocationProposal.id)}
                label={`✓ Accept: ${(pendingLocationProposal.payload as { locationName?: string }).locationName}`}
                accent
              />
            )}

            {/* Confirm plan */}
            {canConfirm && (
              <ActionChip onClick={() => doAction("CONFIRM_PLAN")} label="✅ Confirm plan" accent />
            )}

            {/* Running late */}
            {match.status === "DATE_ACTIVE" && (
              <ActionChip onClick={() => doAction("RUNNING_LATE", { message: "Running a bit late!" })} label="⏰ Running late" />
            )}

            {/* Cancel */}
            {!isConfirmed && (
              <ActionChip onClick={() => { if (confirm("Cancel this match?")) doAction("CANCEL"); }} label="✕ Cancel" danger />
            )}
          </div>

          {/* Message input */}
          {canSendMessage && (
            <div className="flex gap-2 mt-2">
              <div className="flex-1 relative">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder={`Say something… (${MAX_MESSAGES - messageCount} left)`}
                  maxLength={500}
                  className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">
                  {messageCount}/{MAX_MESSAGES}
                </span>
              </div>
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                className="bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
          )}

          {messagesExhausted && !isConfirmed && (
            <div className="text-center text-xs text-stone-400 mt-2 py-1">
              Message limit reached. Use the buttons above to coordinate.
            </div>
          )}
        </div>
      )}

      {/* Time picker modal */}
      {showTimePicker && (
        <Modal onClose={() => setShowTimePicker(false)}>
          <h3 className="font-bold text-stone-900 mb-3">Propose a time</h3>
          <input
            type="datetime-local"
            value={proposedTime}
            onChange={(e) => setProposedTime(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={() => {
              if (proposedTime) {
                doAction("PROPOSE_TIME", { proposedDatetime: proposedTime });
                setShowTimePicker(false);
              }
            }}
            disabled={!proposedTime}
            className="w-full mt-3 bg-brand-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            Send proposal
          </button>
        </Modal>
      )}

      {/* Location picker modal */}
      {showLocationPicker && (
        <Modal onClose={() => setShowLocationPicker(false)}>
          <h3 className="font-bold text-stone-900 mb-3">Propose a location</h3>
          <input
            type="text"
            value={proposedLocation}
            onChange={(e) => setProposedLocation(e.target.value)}
            placeholder="e.g. Starbucks on Main St, Vondelpark"
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={() => {
              if (proposedLocation) {
                doAction("PROPOSE_LOCATION", { locationName: proposedLocation });
                setShowLocationPicker(false);
              }
            }}
            disabled={!proposedLocation}
            className="w-full mt-3 bg-brand-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            Send proposal
          </button>
        </Modal>
      )}
    </div>
  );
}

function ActionChip({ label, onClick, accent, danger }: { label: string; onClick: () => void; accent?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex-shrink-0 ${
        accent ? "bg-brand-600 text-white border-brand-600 hover:bg-brand-700"
        : danger ? "border-red-200 text-red-600 hover:bg-red-50"
        : "border-stone-200 text-stone-700 hover:bg-stone-100"
      }`}
    >
      {label}
    </button>
  );
}

function SystemActionBubble({ action, currentUserId, otherName, onAccept }: {
  action: SystemAction;
  currentUserId: string;
  otherName: string;
  onAccept: (type: string, payload: Record<string, unknown>, id?: string) => void;
}) {
  const isMine = action.initiatorId === currentUserId;
  const who = isMine ? "You" : otherName;

  let label = "";
  let detail = "";

  switch (action.actionType) {
    case "PROPOSE_TIME": {
      const dt = (action.payload as { proposedDatetime?: string }).proposedDatetime;
      label = `${who} proposed a time`;
      detail = dt ? new Date(dt).toLocaleString() : "";
      break;
    }
    case "ACCEPT_TIME":
      label = `${who} accepted the time ✓`;
      break;
    case "PROPOSE_LOCATION":
      label = `${who} proposed a location`;
      detail = (action.payload as { locationName?: string }).locationName ?? "";
      break;
    case "ACCEPT_LOCATION":
      label = `${who} accepted the location ✓`;
      break;
    case "CONFIRM_PLAN":
      label = "Plan confirmed! 🎉";
      break;
    case "RUNNING_LATE":
      label = `${who} is running late`;
      break;
    case "CANCEL":
      label = `${who} cancelled`;
      break;
    default:
      label = action.actionType;
  }

  return (
    <div className="text-center">
      <div className="inline-block bg-stone-100 text-stone-600 text-xs px-3 py-1.5 rounded-full">
        {label}
        {detail && <span className="font-medium ml-1">{detail}</span>}
      </div>
      {!action.acceptedAt && !isMine && (action.actionType === "PROPOSE_TIME" || action.actionType === "PROPOSE_LOCATION") && (
        <div className="mt-1">
          <button
            onClick={() => {
              const acceptType = action.actionType === "PROPOSE_TIME" ? "ACCEPT_TIME" : "ACCEPT_LOCATION";
              onAccept(acceptType, {}, action.id);
            }}
            className="text-xs text-brand-600 font-medium hover:underline"
          >
            Accept
          </button>
        </div>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl p-6 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
