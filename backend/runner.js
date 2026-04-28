const puppeteer = require("puppeteer");
const { parse } = require("csv-parse/sync");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(list) {
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function biasToRating(bias) {
  const clamped = clamp(bias, 0, 100);
  const mean = 1 + (clamped / 100) * 4;
  const jitter = (Math.random() - 0.5) * 2.0;
  return clamp(Math.round(mean + jitter), 1, 5);
}

function pickCheckboxCount(bias, optionCount) {
  if (optionCount <= 1) return 1;
  const clamped = clamp(bias, 0, 100);
  const base = 1 + Math.round((clamped / 100) * (optionCount - 1));
  const jitter = Math.random() < 0.5 ? -1 : 0;
  return clamp(base + jitter, 1, optionCount);
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function generateEmail(baseNames, domain, index) {
  const safeDomain = String(domain || "example.com").trim();
  const bases = Array.isArray(baseNames) && baseNames.length > 0
    ? baseNames
    : ["user"];
  const base = bases[(index - 1) % bases.length];
  return `${base}${index}@${safeDomain}`;
}

function buildLaunchOptions(headless) {
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
  const userDataDir = process.env.BROWSER_USER_DATA_DIR || null;
  const profileDir = process.env.BROWSER_PROFILE_DIR || null;
  const args = [];

  if (profileDir) {
    args.push(`--profile-directory=${profileDir}`);
  }

  return {
    headless,
    defaultViewport: null,
    executablePath: executablePath || undefined,
    userDataDir: userDataDir || undefined,
    args,
  };
}

function readCsvRows(buffer) {
  if (!buffer) return [];
  const csvText = buffer.toString("utf8");
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function findCsvValue(row, field) {
  if (!row || !field) return null;
  const key = normalizeKey(field.key || field.label);
  if (!key) return null;

  const exact = Object.keys(row).find(
    header => normalizeKey(header) === key
  );
  if (exact) return row[exact];

  const loose = Object.keys(row).find(
    header => normalizeKey(header).includes(key)
  );
  if (loose) return row[loose];

  return null;
}

async function fillTextField(page, field, value) {
  if (!value) return;
  const input = await page.$(`input[aria-label*="${field.label}"]`);
  if (input) {
    await input.click({ clickCount: 3 });
    await input.type(String(value));
  }
}

async function findQuestionContainer(page, questionText) {
  const handle = await page.evaluateHandle(text => {
    const makeLiteral = value => {
      if (!value.includes('"')) {
        return `"${value}"`;
      }
      if (!value.includes("'")) {
        return `'${value}'`;
      }
      const parts = value.split('"').map(part => `"${part}"`);
      return "concat(" + parts.join(", '\"', ") + ")";
    };

    const literal = makeLiteral(text);
    const xpath = `//div[@role="listitem"]//*[normalize-space()=${literal}]/ancestor::div[@role="listitem"][1]`;
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;

    return result || null;
  }, questionText);

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  return element;
}

async function answerRating(container, bias) {
  const group = await container.$("div[role='radiogroup']");
  if (!group) return false;
  const options = await group.$$("div[role='radio']");
  if (options.length === 0) return false;

  const rating = clamp(biasToRating(bias), 1, options.length);
  await options[rating - 1].click();
  return true;
}

async function answerMultipleChoice(container, optionsList) {
  const group = await container.$("div[role='radiogroup']");
  if (!group) return false;

  if (optionsList?.length) {
    for (const option of optionsList) {
      const optionHandle = await group.$(`div[role='radio'][aria-label="${option}"]`);
      if (optionHandle) {
        await optionHandle.click();
        return true;
      }
    }
  }

  const radios = await group.$$("div[role='radio']");
  if (radios.length === 0) return false;
  await radios[randomInt(0, radios.length - 1)].click();
  return true;
}

async function answerCheckboxes(container, optionsList, bias) {
  const boxes = await container.$$("div[role='checkbox']");
  if (boxes.length === 0) return false;

  if (optionsList?.length) {
    let selected = 0;
    for (const option of optionsList) {
      const handle = await container.$(`div[role='checkbox'][aria-label="${option}"]`);
      if (handle) {
        await handle.click();
        selected++;
      }
    }
    return selected > 0;
  }

  const count = pickCheckboxCount(bias, boxes.length);
  const shuffled = boxes.sort(() => Math.random() - 0.5);
  for (let i = 0; i < count; i++) {
    await shuffled[i].click();
  }
  return true;
}

async function answerQuestions(page, questions, bias, stopOnError) {
  for (const question of questions) {
    const container = await findQuestionContainer(page, question.text);
    if (!container) {
      const message = `Question not found: ${question.text}`;
      if (stopOnError) {
        throw new Error(message);
      }
      console.warn(message);
      continue;
    }

    if (question.type === "rating") {
      await answerRating(container, bias);
    } else if (question.type === "multiple") {
      await answerMultipleChoice(container, question.options || []);
    } else if (question.type === "checkbox") {
      await answerCheckboxes(container, question.options || [], bias);
    }
  }
}

function buildRow(fields, row, listsByKey, submissionIndex, emailSettings) {
  const result = {};
  for (const field of fields) {
    if (field.source === "none") continue;

    const csvValue = row ? findCsvValue(row, field) : null;
    if (csvValue) {
      result[field.key] = csvValue;
      continue;
    }

    if (field.source === "list") {
      const list = listsByKey[field.key] || [];
      const picked = pickRandom(list);
      if (picked) result[field.key] = picked;
    }

    if (!result[field.key] && emailSettings?.enabled && field.autoEmail) {
      result[field.key] = generateEmail(
        emailSettings.baseNames,
        emailSettings.domain,
        submissionIndex
      );
    }
  }
  return result;
}

async function runAutofill({ config, csvBuffer }) {
  const formUrl = String(config.formUrl || "").trim();
  if (!formUrl) {
    throw new Error("Form URL is required");
  }

  const bias = clamp(Number(config.bias || 50), 0, 100);
  const questions = Array.isArray(config.questions) ? config.questions : [];
  const fields = Array.isArray(config.personalFields) ? config.personalFields : [];
  const listsByKey = config.personalLists || {};
  const emailSettings = config.emailSettings || null;
  const csvRows = readCsvRows(csvBuffer);

  const submissions = Number(config.submissions || 0) || csvRows.length || 1;
  const headless = Boolean(config.headless);
  const stopOnError = config.stopOnError !== false;

  const browser = await puppeteer.launch(buildLaunchOptions(headless));
  const page = await browser.newPage();

  for (let i = 0; i < submissions; i++) {
    const row = csvRows[i % Math.max(csvRows.length, 1)] || null;
    const rowValues = buildRow(fields, row, listsByKey, i + 1, emailSettings);

    await page.goto(formUrl, { waitUntil: "networkidle2" });

    for (const field of fields) {
      const value = rowValues[field.key] || null;
      await fillTextField(page, field, value);
    }

    await answerQuestions(page, questions, bias, stopOnError);

    const submit = await page.$('div[role="button"][aria-label*="Submit"]');
    if (!submit) {
      const message = "Submit button not found.";
      if (stopOnError) {
        throw new Error(message);
      }
      console.warn(message);
    } else {
      await submit.click();
    }
  }

  await browser.close();

  return { submissions, usedCsvRows: csvRows.length };
}

module.exports = {
  runAutofill,
};
