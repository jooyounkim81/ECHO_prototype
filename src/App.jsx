import { useState, useRef, useEffect } from "react";

const NAVER_FORM_URL = "https://naver.me/xzHlchMd";

const SCENARIO = {
  title: "상대방 이야기 들어주기",
  description: "지인이 요즘 힘든 일이 있다고 털어놓기 시작합니다. 잘 들어주고 반응해보세요.",
  aiRole: "고민 있는 지인",
  maxTurns: 6,
  systemPrompt: `당신은 요즘 힘든 일이 있어서 털어놓고 싶은 지인입니다.

규칙:
- 처음엔 "요즘 좀 힘들어서..."로 조심스럽게 시작하세요
- 사용자가 공감하고 잘 들어주면 더 깊이 털어놓으세요
- 바로 조언하면 "그냥 들어줬으면 했는데..."라고 하세요
- 사용자가 자기 얘기로 넘기면 실망한 반응을 하세요
- 짧게 단답만 하면 "바쁜 거야? 나중에 얘기할까?"라고 하세요
- 잘 들어주면 마지막에 "얘기하니까 좀 나네, 고마워"로 마무리하세요
- 자연스러운 한국어 구어체로 말하세요
- AI임을 절대 밝히지 마세요`,
};

function buildFeedbackPrompt(messages) {
  const conversation = messages
    .map((m) => `${m.role === "user" ? "사용자" : "지인"}: ${m.content}`)
    .join("\n");
  return `다음 대화를 분석해서 JSON만 출력하세요. 마크다운 없이 순수 JSON만.

대화:
${conversation}

출력 형식:
{
  "score": 75,
  "grade": "보통",
  "summary": "전반적인 평가 한 줄",
  "positives": ["잘한 점 1", "잘한 점 2"],
  "improvements": ["개선할 점 1", "개선할 점 2"],
  "pattern": "대화 패턴 유형",
  "tip": "다음에 이렇게 해보세요 한 문장"
}

점수 기준: 공감·경청·되묻기 → 높음 / 조언·단답·자기얘기 → 낮음`;
}

async function callGemini(systemPrompt, messages) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const payload = { contents, generationConfig: { maxOutputTokens: 1000 } };
  if (systemPrompt) payload.system_instruction = { parts: [{ text: systemPrompt }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Gemini 오류 ${res.status}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export default function App() {
  const [phase, setPhase] = useState("intro");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [error, setError] = useState(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("크롬 브라우저를 사용하거나 키보드 마이크 버튼을 이용해주세요."); return; }
    const r = new SR();
    r.lang = "ko-KR"; r.continuous = false; r.interimResults = false;
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.onresult = (e) => setInput(e.results[0][0].transcript);
    recognitionRef.current = r;
    r.start();
  }

  function stopListening() { recognitionRef.current?.stop(); setListening(false); }

  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }

  function stopSpeaking() { window.speechSynthesis?.cancel(); setSpeaking(false); }

  async function startChat() {
    setMessages([]); setTurnCount(0); setFeedback(null);
    setError(null); setPhase("chat"); setLoading(true); stopSpeaking();
    try {
      const text = await callGemini(SCENARIO.systemPrompt, [
        { role: "user", content: "대화를 시작해주세요. 먼저 자연스럽게 말을 걸어주세요." }
      ]);
      setMessages([{ role: "assistant", content: text }]);
      speak(text);
    } catch (e) {
      setError(e.message);
      const f = "요즘 좀 힘들어서... 잠깐 얘기해도 돼?";
      setMessages([{ role: "assistant", content: f }]);
      speak(f);
    }
    setLoading(false);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    stopSpeaking();
    const userMsg = { role: "user", content: input.trim() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs); setInput(""); setLoading(true); setError(null);
    const newTurn = turnCount + 1; setTurnCount(newTurn);
    const isLast = newTurn >= SCENARIO.maxTurns;
    try {
      const sys = SCENARIO.systemPrompt + (isLast ? "\n\n지금은 마지막 대화입니다. 자연스럽게 마무리해주세요." : "");
      const text = await callGemini(sys, newMsgs.map(m => ({ role: m.role, content: m.content })));
      const updated = [...newMsgs, { role: "assistant", content: text }];
      setMessages(updated);
      speak(text);
      if (isLast) setTimeout(() => getFeedback(updated), 3000);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function getFeedback(msgs) {
    stopSpeaking(); setFeedbackLoading(true); setPhase("feedback");
    try {
      const text = await callGemini("", [{ role: "user", content: buildFeedbackPrompt(msgs) }]);
      const clean = text.replace(/```json|```/g, "").trim();
      setFeedback(JSON.parse(clean));
    } catch (e) {
      setError(e.message);
      setFeedback({ score: 0, grade: "분석 실패", summary: "피드백 오류", positives: [], improvements: [], pattern: "알 수 없음", tip: "다시 시도해보세요." });
    }
    setFeedbackLoading(false);
  }

  const sc = (s) => s >= 80 ? "#4CAF50" : s >= 60 ? "#FF9800" : "#F44336";

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.hInner}>
          <span style={S.logo}>ECHO</span>
          <span style={S.logoSub}>prototype3 V1</span>
        </div>
      </div>

      {error && <div style={S.err}>⚠️ {error}</div>}

      <div style={S.container}>

        {phase === "intro" && (
          <div style={S.card}>
            <div style={S.circle}><span style={S.circleText}>ECHO</span></div>
            <h1 style={S.introTitle}>AI 인터랙션 반응 연구</h1>
            <p style={S.introDesc}>
              지인이 힘든 일을 털어놓는 상황입니다.<br />
              AI와 대화하고 내 대화 습관을 확인해보세요.<br />
              약 <strong>5~8분</strong> 소요됩니다.
            </p>
            <div style={S.infoBox}>
              <span>✓ 설치 불필요</span>
              <span>✓ 음성 지원</span>
              <span>✓ 정답 없음</span>
            </div>
            <div style={S.voiceNote}>
              🎤 말하기 버튼으로 음성 입력 가능<br />
              🔊 AI 답변이 자동으로 읽혀집니다<br />
              <span style={{ fontSize: 11, color: "#888" }}>아이폰은 키보드 마이크 버튼을 사용하세요</span>
            </div>
            <div style={S.preview}>
              <div style={S.previewLabel}>오늘의 시나리오</div>
              <div style={S.previewTitle}>{SCENARIO.title}</div>
              <div style={S.previewDesc}>{SCENARIO.description}</div>
            </div>
            <button style={S.btnP} onClick={startChat}>시작하기 →</button>
          </div>
        )}

        {phase === "chat" && (
          <div style={S.chatWrap}>
            <div style={S.chatHead}>
              <div>
                <div style={S.chatTitle}>{SCENARIO.title}</div>
                <div style={S.chatRole}>상대: {SCENARIO.aiRole}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {speaking && <button onClick={stopSpeaking} style={S.stopBtn}>🔊 중지</button>}
                <div style={S.badge}>{turnCount} / {SCENARIO.maxTurns}</div>
              </div>
            </div>
            <div style={S.situation}>{SCENARIO.description}</div>
            <div style={S.msgs}>
              {messages.map((m, i) => (
                <div key={i} style={{ ...S.msgRow, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  {m.role === "assistant" && <div style={S.avatar}>AI</div>}
                  <div style={{
                    ...S.bubble,
                    background: m.role === "user" ? "#2C5F8A" : "#F0F0F0",
                    color: m.role === "user" ? "#fff" : "#222",
                    borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                  }}>{m.content}</div>
                </div>
              ))}
              {loading && (
                <div style={{ ...S.msgRow, justifyContent: "flex-start" }}>
                  <div style={S.avatar}>AI</div>
                  <div style={{ ...S.bubble, background: "#F0F0F0", color: "#999" }}>● ● ●</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={S.inputRow}>
              <input
                style={S.input}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={listening ? "듣고 있습니다..." : "메시지를 입력하세요..."}
                disabled={loading}
              />
              <button style={{ ...S.mic, background: listening ? "#CC0000" : "#2C5F8A" }}
                onClick={listening ? stopListening : startListening} disabled={loading}>
                {listening ? "■" : "🎤"}
              </button>
              <button style={{ ...S.send, opacity: loading || !input.trim() ? 0.4 : 1 }}
                onClick={sendMessage} disabled={loading || !input.trim()}>전송</button>
            </div>
          </div>
        )}

        {phase === "feedback" && (
          <div style={S.card}>
            {feedbackLoading ? (
              <div style={S.loadWrap}>
                <div style={S.spinner} />
                <p style={{ color: "#666", marginTop: 12 }}>대화를 분석하고 있습니다...</p>
              </div>
            ) : feedback && (
              <>
                <h2 style={S.fbTitle}>대화 분석 결과</h2>
                <div style={S.scoreWrap}>
                  <span style={{ ...S.scoreNum, color: sc(feedback.score) }}>{feedback.score}</span>
                  <span style={S.scoreMax}> / 100</span>
                </div>
                <div style={{ ...S.gradeBadge, background: sc(feedback.score) }}>
                  {feedback.grade} · {feedback.pattern}
                </div>
                <p style={S.summary}>{feedback.summary}</p>
                {feedback.positives?.length > 0 && (
                  <div style={S.section}>
                    <div style={S.secLabel}>✓ 잘한 점</div>
                    {feedback.positives.map((p, i) => (
                      <div key={i} style={{ ...S.feedItem, borderLeft: "3px solid #4CAF50" }}>{p}</div>
                    ))}
                  </div>
                )}
                {feedback.improvements?.length > 0 && (
                  <div style={S.section}>
                    <div style={S.secLabel}>↑ 개선할 점</div>
                    {feedback.improvements.map((p, i) => (
                      <div key={i} style={{ ...S.feedItem, borderLeft: "3px solid #FF9800" }}>{p}</div>
                    ))}
                  </div>
                )}
                <div style={S.tipBox}>
                  <div style={S.tipLabel}>💡 다음엔 이렇게</div>
                  <p style={S.tipText}>{feedback.tip}</p>
                </div>
                <div style={S.formBox}>
                  <div style={S.formLabel}>📋 체험 후 설문에 참여해주세요</div>
                  <p style={S.formDesc}>3분이면 충분합니다. 솔직한 의견이 연구에 큰 도움이 됩니다.</p>
                  <a href={NAVER_FORM_URL} target="_blank" rel="noreferrer" style={S.formBtn}>설문 참여하기 →</a>
                </div>
                <div style={S.btnRow}>
                  <button style={S.btnS} onClick={startChat}>다시 해보기</button>
                  <button style={S.btnP} onClick={() => setPhase("intro")}>처음으로</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  root: { minHeight: "100vh", background: "#F4F7FB", fontFamily: "'Noto Sans KR','Apple SD Gothic Neo',sans-serif" },
  header: { background: "#1A3A5C", padding: "14px 24px" },
  hInner: { display: "flex", alignItems: "baseline", gap: 10, maxWidth: 640, margin: "0 auto" },
  logo: { color: "#fff", fontWeight: 900, fontSize: 20, letterSpacing: 4 },
  logoSub: { color: "#8BB8D4", fontSize: 11 },
  err: { background: "#FFF0F0", color: "#CC0000", fontSize: 13, padding: "10px 20px", borderBottom: "1px solid #FFD0D0" },
  container: { maxWidth: 640, margin: "0 auto", padding: "24px 16px 48px" },
  card: { background: "#fff", borderRadius: 20, padding: "32px 28px", boxShadow: "0 2px 20px rgba(0,0,0,0.08)" },
  circle: { width: 72, height: 72, borderRadius: "50%", background: "#1A3A5C", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" },
  circleText: { color: "#fff", fontWeight: 900, fontSize: 16, letterSpacing: 3 },
  introTitle: { fontSize: 22, fontWeight: 800, color: "#1A3A5C", textAlign: "center", margin: "0 0 12px" },
  introDesc: { fontSize: 15, color: "#555", textAlign: "center", lineHeight: 1.8, margin: "0 0 20px" },
  infoBox: { display: "flex", justifyContent: "center", gap: 20, color: "#2C5F8A", fontSize: 13, fontWeight: 600, margin: "0 0 16px" },
  voiceNote: { background: "#F0F5FA", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#444", lineHeight: 1.8, textAlign: "center", margin: "0 0 20px" },
  preview: { background: "#EEF4FA", borderRadius: 14, padding: "16px 20px", margin: "0 0 24px" },
  previewLabel: { fontSize: 11, fontWeight: 700, color: "#2C5F8A", letterSpacing: 2, marginBottom: 6 },
  previewTitle: { fontSize: 16, fontWeight: 700, color: "#1A3A5C", marginBottom: 6 },
  previewDesc: { fontSize: 13, color: "#555", lineHeight: 1.6 },
  btnP: { width: "100%", padding: 14, background: "#1A3A5C", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer" },
  btnS: { flex: 1, padding: 13, background: "#F0F0F0", color: "#333", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer" },
  btnRow: { display: "flex", gap: 12, marginTop: 16 },
  chatWrap: { background: "#fff", borderRadius: 20, boxShadow: "0 2px 20px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", height: "calc(100vh - 130px)", overflow: "hidden" },
  chatHead: { padding: "16px 20px", borderBottom: "1px solid #EEE", display: "flex", justifyContent: "space-between", alignItems: "center" },
  chatTitle: { fontSize: 15, fontWeight: 700, color: "#1A3A5C" },
  chatRole: { fontSize: 12, color: "#888", marginTop: 2 },
  badge: { background: "#EEF4FA", color: "#2C5F8A", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20 },
  stopBtn: { background: "#FFF0F0", color: "#CC0000", border: "1px solid #FFCCCC", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer" },
  situation: { background: "#FFF8EE", borderLeft: "3px solid #E07000", padding: "10px 16px", fontSize: 13, color: "#555", lineHeight: 1.6, margin: "0 16px 8px", borderRadius: "0 8px 8px 0" },
  msgs: { flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 },
  msgRow: { display: "flex", alignItems: "flex-end", gap: 8 },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: "#1A3A5C", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  bubble: { maxWidth: "75%", padding: "10px 14px", fontSize: 14, lineHeight: 1.6, wordBreak: "break-word" },
  inputRow: { display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid #EEE" },
  input: { flex: 1, padding: "12px 14px", border: "1.5px solid #DDD", borderRadius: 12, fontSize: 14, outline: "none", fontFamily: "inherit" },
  mic: { width: 44, height: 44, border: "none", borderRadius: 12, fontSize: 18, cursor: "pointer", color: "#fff", flexShrink: 0 },
  send: { padding: "12px 16px", background: "#1A3A5C", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  loadWrap: { textAlign: "center", padding: "48px 0" },
  spinner: { width: 40, height: 40, border: "3px solid #EEE", borderTop: "3px solid #2C5F8A", borderRadius: "50%", margin: "0 auto", animation: "spin 1s linear infinite" },
  fbTitle: { fontSize: 20, fontWeight: 800, color: "#1A3A5C", margin: "0 0 20px", textAlign: "center" },
  scoreWrap: { textAlign: "center", margin: "0 0 8px" },
  scoreNum: { fontSize: 56, fontWeight: 900 },
  scoreMax: { fontSize: 20, color: "#AAA" },
  gradeBadge: { color: "#fff", fontSize: 13, fontWeight: 700, padding: "5px 14px", borderRadius: 20, margin: "0 auto 16px", display: "table" },
  summary: { fontSize: 15, color: "#444", textAlign: "center", lineHeight: 1.7, margin: "0 0 24px" },
  section: { marginBottom: 16 },
  secLabel: { fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 8 },
  feedItem: { padding: "10px 14px", background: "#FAFAFA", borderRadius: 8, fontSize: 14, color: "#333", lineHeight: 1.6, marginBottom: 6 },
  tipBox: { background: "#EEF4FA", borderRadius: 12, padding: "14px 18px", marginTop: 8, marginBottom: 16 },
  tipLabel: { fontSize: 12, fontWeight: 700, color: "#2C5F8A" },
  tipText: { fontSize: 14, color: "#1A3A5C", fontWeight: 600, margin: "6px 0 0", lineHeight: 1.6 },
  formBox: { background: "#F8FFF8", border: "1.5px solid #4CAF50", borderRadius: 12, padding: "16px 20px", marginBottom: 16 },
  formLabel: { fontSize: 14, fontWeight: 700, color: "#2A7A2A", marginBottom: 6 },
  formDesc: { fontSize: 13, color: "#555", lineHeight: 1.5, margin: "0 0 12px" },
  formBtn: { display: "block", textAlign: "center", background: "#2A7A2A", color: "#fff", padding: "11px", borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: "none" },
};
