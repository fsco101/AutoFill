import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";

const STORAGE_KEY = "autofill:config";

const defaultQuestion = () => ({
  id: crypto.randomUUID(),
  text: "",
  type: "rating",
  optionsText: "",
});

const defaultField = () => ({
  id: crypto.randomUUID(),
  label: "",
  key: "",
  source: "none",
  listText: "",
  valueType: "text",
  autoEmail: false,
});

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function splitOptions(text) {
  return String(text || "")
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

function isNumericString(value) {
  return /^-?\d+(\.\d+)?$/.test(String(value || "").trim());
}

function ensureQuestion(question) {
  return {
    id: question.id || crypto.randomUUID(),
    text: question.text || "",
    type: question.type || "rating",
    optionsText: question.optionsText || "",
  };
}

function ensureField(field) {
  const label = field.label || "";
  return {
    id: field.id || crypto.randomUUID(),
    label,
    key: field.key || normalizeKey(label),
    source: field.source || "none",
    listText: field.listText || "",
    valueType: field.valueType || "text",
    autoEmail: Boolean(field.autoEmail),
  };
}

function ensureEmailSettings(settings) {
  return {
    enabled: Boolean(settings?.enabled),
    baseNamesText: settings?.baseNamesText || "user",
    domain: settings?.domain || "example.com",
  };
}

function loadPersistedState() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

export default function App() {
  const persisted = loadPersistedState();
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
  const [formUrl, setFormUrl] = useState(persisted?.formUrl || "");
  const [submissions, setSubmissions] = useState(persisted?.submissions || 1);
  const [bias, setBias] = useState(persisted?.bias ?? 50);
  const [headless, setHeadless] = useState(Boolean(persisted?.headless));
  const [questions, setQuestions] = useState(() => {
    const stored = Array.isArray(persisted?.questions) ? persisted.questions : [];
    const normalized = stored.map(ensureQuestion);
    return normalized.length > 0 ? normalized : [defaultQuestion()];
  });
  const [fields, setFields] = useState(() => {
    const stored = Array.isArray(persisted?.fields) ? persisted.fields : [];
    const normalized = stored.map(ensureField);
    return normalized.length > 0 ? normalized : [defaultField()];
  });
  const [emailSettings, setEmailSettings] = useState(() =>
    ensureEmailSettings(persisted?.emailSettings)
  );
  const [questionCountInput, setQuestionCountInput] = useState(
    String(persisted?.questionCountInput || "")
  );
  const [csvFile, setCsvFile] = useState(null);
  const [status, setStatus] = useState({ type: "idle", message: "" });

  useEffect(() => {
    const payload = {
      formUrl,
      submissions: Number(submissions || 1),
      bias,
      headless,
      questions,
      fields,
      questionCountInput,
      emailSettings,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    formUrl,
    submissions,
    bias,
    headless,
    questions,
    fields,
    questionCountInput,
    emailSettings,
  ]);

  const toast = Swal.mixin({
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true,
  });
  const addQuestion = () => {
    setQuestions(prev => [...prev, defaultQuestion()]);
    toast.fire({
      icon: "success",
      title: `Question added (${questions.length + 1})`,
    });
  };

  const applyQuestionCount = () => {
    const target = Number(questionCountInput);
    if (!Number.isFinite(target) || target < 1) {
      toast.fire({
        icon: "warning",
        title: "Enter a valid question count",
      });
      return;
    }

    setQuestions(prev => {
      if (prev.length === target) return prev;
      if (prev.length < target) {
        const additions = Array.from(
          { length: target - prev.length },
          () => defaultQuestion()
        );
        toast.fire({
          icon: "success",
          title: `Added ${additions.length} questions`,
        });
        return [...prev, ...additions];
      }

      toast.fire({
        icon: "success",
        title: `Trimmed to ${target} questions`,
      });
      return prev.slice(0, target);
    });
  };

  const biasLabel = useMemo(() => {
    if (bias <= 25) return "Mostly negative";
    if (bias <= 45) return "Leaning negative";
    if (bias <= 55) return "Balanced";
    if (bias <= 75) return "Leaning positive";
    return "Mostly positive";
  }, [bias]);

  const readyQuestions = questions.filter(item => item.text.trim());
  const readyFields = fields.filter(item => item.label.trim());

  const handleFieldLabelChange = (id, value) => {
    setFields(prev =>
      prev.map(field =>
        field.id === id
          ? {
              ...field,
              label: value,
              key: normalizeKey(value),
            }
          : field
      )
    );
  };

  const addAmountField = () => {
    setFields(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: "Amount",
        key: "amount",
        source: "list",
        listText: "",
        valueType: "number",
      },
    ]);
  };

  const runAutofill = async event => {
    event.preventDefault();

    if (!formUrl.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Missing form link",
        text: "Please add a Google Form URL before running.",
      });
      return;
    }

    if (readyQuestions.length === 0) {
      await Swal.fire({
        icon: "warning",
        title: "No questions",
        text: "Add at least one question to answer.",
      });
      return;
    }

    if (!Number.isFinite(Number(submissions)) || Number(submissions) < 1) {
      await Swal.fire({
        icon: "warning",
        title: "Invalid submissions",
        text: "Submissions must be a positive number.",
      });
      return;
    }

    for (const field of readyFields) {
      if (field.source === "list" && field.valueType === "number") {
        const values = splitOptions(field.listText);
        const invalid = values.find(value => !isNumericString(value));
        if (invalid) {
          await Swal.fire({
            icon: "warning",
            title: "Numeric validation",
            text: `Field "${field.label}" expects numbers only.`,
          });
          return;
        }
      }
    }

    setStatus({ type: "loading", message: "Launching browser..." });

    const personalLists = {};
    const personalFields = readyFields.map(field => {
      if (field.source === "list") {
        personalLists[field.key] = splitOptions(field.listText);
      }

      return {
        key: field.key,
        label: field.label,
        source: field.source,
        autoEmail: field.autoEmail,
      };
    });

    const payload = {
      formUrl,
      submissions: Number(submissions || 1),
      bias: Number(bias),
      headless,
      questions: readyQuestions.map(question => ({
        text: question.text,
        type: question.type,
        options: splitOptions(question.optionsText),
      })),
      personalFields,
      personalLists,
      emailSettings: {
        enabled: emailSettings.enabled,
        baseNames: splitOptions(emailSettings.baseNamesText),
        domain: emailSettings.domain,
      },
    };

    const formData = new FormData();
    formData.append("config", JSON.stringify(payload));
    if (csvFile) formData.append("csv", csvFile);

    try {
      const response = await fetch(`${apiBaseUrl}/api/run`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Backend error");
      }

      const data = await response.json();
      setStatus({ type: "idle", message: "" });
      await Swal.fire({
        icon: "success",
        title: "Autofill complete",
        text: `Completed ${data.result.submissions} submissions.`,
      });
    } catch (err) {
      setStatus({ type: "idle", message: "" });
      await Swal.fire({
        icon: "error",
        title: "Run failed",
        text: "Check backend logs for details.",
      });
    }
  };

  return (
    <div className="page">
      <main className="shell">
        <header className="hero">
          <p className="eyebrow">Autofill studio</p>
          <h1>Shape the survey mood before you hit run.</h1>
          <p className="lede">
            Build a dynamic recipe for Google Forms: link, questions, personal
            info lists, and a bias slider that nudges ratings without touching
            your template.
          </p>
        </header>

        <form className="form" onSubmit={runAutofill}>
          <section className="panel stagger" style={{ "--delay": "0ms" }}>
            <h2>Form link</h2>
            <label className="field">
              <span>Google Form URL</span>
              <input
                type="url"
                placeholder="https://docs.google.com/forms/d/e/..."
                value={formUrl}
                onChange={event => setFormUrl(event.target.value)}
                required
              />
            </label>
          </section>

          <section className="panel grid stagger" style={{ "--delay": "60ms" }}>
            <div className="field">
              <span>Submissions</span>
              <input
                type="number"
                min="1"
                step="1"
                value={submissions}
                onChange={event => setSubmissions(event.target.value)}
              />
            </div>
            <div className="field">
              <span>Browser mode</span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={event => setHeadless(event.target.checked)}
                />
                <span>Headless</span>
              </label>
            </div>
          </section>

          <section className="panel stagger" style={{ "--delay": "120ms" }}>
            <div className="panel-header">
              <div>
                <h2>Bias slider</h2>
                <p className="hint">Only affects rating questions.</p>
              </div>
              <div className="chip">{biasLabel}</div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={bias}
              onChange={event => setBias(Number(event.target.value))}
            />
          </section>

          <section className="panel stagger" style={{ "--delay": "180ms" }}>
            <div className="panel-header">
              <div>
                <h2>Questions</h2>
                <p className="hint">
                  Match the exact question text shown in Google Forms.
                </p>
              </div>
              <div className="panel-actions">
                <div className="count-field">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Count"
                    value={questionCountInput}
                    onChange={event => setQuestionCountInput(event.target.value)}
                  />
                  <button className="ghost" type="button" onClick={applyQuestionCount}>
                    Set count
                  </button>
                </div>
                <button className="ghost" type="button" onClick={addQuestion}>
                  Add question
                </button>
              </div>
            </div>

            <div className="stack">
              {questions.map((question, index) => (
                <div key={question.id} className="card">
                  <div className="card-header">
                    <h3>Question {index + 1}</h3>
                    {questions.length > 1 && (
                      <button
                        className="ghost danger"
                        type="button"
                        onClick={() =>
                          setQuestions(prev =>
                            prev.filter(item => item.id !== question.id)
                          )
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <label className="field">
                    <span>Question text</span>
                    <input
                      type="text"
                      value={question.text}
                      onChange={event =>
                        setQuestions(prev =>
                          prev.map(item =>
                            item.id === question.id
                              ? { ...item, text: event.target.value }
                              : item
                          )
                        )
                      }
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Answer type</span>
                    <select
                      value={question.type}
                      onChange={event =>
                        setQuestions(prev =>
                          prev.map(item =>
                            item.id === question.id
                              ? { ...item, type: event.target.value }
                              : item
                          )
                        )
                      }
                    >
                      <option value="rating">Rating</option>
                      <option value="multiple">Multiple choice</option>
                      <option value="checkbox">Checkboxes</option>
                    </select>
                  </label>
                  {question.type !== "rating" && (
                    <label className="field">
                      <span>Options (comma or new line separated)</span>
                      <textarea
                        rows="3"
                        value={question.optionsText}
                        onChange={event =>
                          setQuestions(prev =>
                            prev.map(item =>
                              item.id === question.id
                                ? { ...item, optionsText: event.target.value }
                                : item
                            )
                          )
                        }
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel stagger" style={{ "--delay": "240ms" }}>
            <div className="panel-header">
              <div>
                <h2>Personal info fields</h2>
                <p className="hint">
                  Text inputs like name or age. CSV headers should match the
                  field label.
                </p>
              </div>
              <div className="panel-actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setFields(prev => [...prev, defaultField()])}
                >
                  Add field
                </button>
                <button className="ghost" type="button" onClick={addAmountField}>
                  Add amount
                </button>
              </div>
            </div>

            <div className="stack">
              {fields.map((field, index) => (
                <div key={field.id} className="card">
                  <div className="card-header">
                    <h3>Field {index + 1}</h3>
                    {fields.length > 1 && (
                      <button
                        className="ghost danger"
                        type="button"
                        onClick={() =>
                          setFields(prev =>
                            prev.filter(item => item.id !== field.id)
                          )
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <label className="field">
                    <span>Label text</span>
                    <input
                      type="text"
                      value={field.label}
                      onChange={event =>
                        handleFieldLabelChange(field.id, event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Source</span>
                    <select
                      value={field.source}
                      onChange={event =>
                        setFields(prev =>
                          prev.map(item =>
                            item.id === field.id
                              ? { ...item, source: event.target.value }
                              : item
                          )
                        )
                      }
                    >
                      <option value="none">Not required</option>
                      <option value="list">Manual list</option>
                      <option value="csv">CSV file</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Value type</span>
                    <select
                      value={field.valueType}
                      onChange={event =>
                        setFields(prev =>
                          prev.map(item =>
                            item.id === field.id
                              ? { ...item, valueType: event.target.value }
                              : item
                          )
                        )
                      }
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                    </select>
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={field.autoEmail}
                      onChange={event =>
                        setFields(prev =>
                          prev.map(item =>
                            item.id === field.id
                              ? { ...item, autoEmail: event.target.checked }
                              : item
                          )
                        )
                      }
                    />
                    <span>Auto-generate email if missing</span>
                  </label>
                  {field.source === "list" && (
                    <label className="field">
                      <span>
                        Values (one per line){" "}
                        {field.valueType === "number" ? "- numbers only" : ""}
                      </span>
                      <textarea
                        rows="3"
                        value={field.listText}
                        onChange={event =>
                          setFields(prev =>
                            prev.map(item =>
                              item.id === field.id
                                ? { ...item, listText: event.target.value }
                                : item
                            )
                          )
                        }
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>

            <label className="field upload">
              <span>CSV file (optional)</span>
              <input
                type="file"
                accept=".csv"
                onChange={event => setCsvFile(event.target.files?.[0] || null)}
              />
              <p className="hint">
                CSV column headers should match your field labels (case-insensitive).
              </p>
            </label>
          </section>

          <section className="panel stagger" style={{ "--delay": "270ms" }}>
            <div className="panel-header">
              <div>
                <h2>Email generator</h2>
                <p className="hint">
                  Used only for fields where auto-generate is enabled.
                </p>
              </div>
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={emailSettings.enabled}
                onChange={event =>
                  setEmailSettings(prev => ({
                    ...prev,
                    enabled: event.target.checked,
                  }))
                }
              />
              <span>Enable email generator</span>
            </label>

            {emailSettings.enabled && (
              <div className="stack">
                <label className="field">
                  <span>Base names (comma or new line)</span>
                  <input
                    type="text"
                    value={emailSettings.baseNamesText}
                    onChange={event =>
                      setEmailSettings(prev => ({
                        ...prev,
                        baseNamesText: event.target.value,
                      }))
                    }
                    placeholder="user, test"
                  />
                </label>
                <label className="field">
                  <span>Domain</span>
                  <input
                    type="text"
                    value={emailSettings.domain}
                    onChange={event =>
                      setEmailSettings(prev => ({
                        ...prev,
                        domain: event.target.value,
                      }))
                    }
                    placeholder="example.com"
                  />
                </label>
              </div>
            )}
          </section>

          <section className="panel action stagger" style={{ "--delay": "300ms" }}>
            <button className="primary" type="submit" disabled={status.type === "loading"}>
              {status.type === "loading" ? "Running..." : "Run autofill"}
            </button>
            {status.message && (
              <p className={`status ${status.type}`}>{status.message}</p>
            )}
          </section>
        </form>
      </main>
    </div>
  );
}
