// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is missing. Create a .env file with OPENAI_API_KEY=...");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "receiptvault-ai-server" });
});

// Simple home page
app.get("/", (req, res) => {
  res.type("text").send("ReceiptVault AI Server is running. Try /health or POST /analyze");
});

// Analyze OCR text
app.post("/analyze", async (req, res) => {
  try {
    const { text } = req.body ?? {};

    if (typeof text !== "string" || text.trim().length < 5) {
      return res.status(400).json({
        error: 'Invalid request. Send JSON body like: { "text": "..." }',
      });
    }

    const systemPrompt = [
      "You extract fields from receipt, deposit, and payment OCR text.",
      "Return ONLY a JSON object with exactly these keys:",
      "vendor, amount, date, accountNumber.",
      "Each value must be a string or null.",
      "date must be YYYY-MM-DD or null.",
      "",
      "Field rules:",
      "1. vendor:",
      "- For receipts/deposits: choose the merchant/business name, not address, city, phone, totals, tax lines, terminal lines, or slogans.",
      "- For checks/payments: choose the payee, not the payer/company, bank, memo, signature, or amount line.",
      "",
      "2. amount:",
      "- Choose the most likely final total/payment amount.",
      "",
      "3. date:",
      "- Return the most likely transaction date in YYYY-MM-DD format.",
      "",
      "4. accountNumber:",
      "- Return ONLY the payment card/account identifier last 4 digits when clearly tied to the payment card.",
      "- Return only the last 4 digits, for example '1234'.",
      "- Do NOT return more than 4 digits.",
      "",
      "Priority for accountNumber:",
      "A. A card brand line with 4 digits, such as:",
      "   - AMERICAN EXPRESS 1005",
      "   - AMEX 1005",
      "   - VISA 1234",
      "   - MASTERCARD 8987",
      "B. A masked card pattern such as:",
      "   - ************1234",
      "   - ****1234",
      "   - ending in 1234",
      "   - account ending 1234",
      "C. A card brand on one line and masked/trailing 4 digits on the next nearby line.",
      "",
      "Do NOT use these as accountNumber:",
      "- terminal number",
      "- merchant ID",
      "- invoice number",
      "- trace number",
      "- reference/ref number",
      "- approval/auth code",
      "- AID",
      "- TVR",
      "- batch number",
      "- transaction number",
      "- totals or amounts",
      "",
      "Important:",
      "- If the card last 4 is not clearly visible, return null.",
      "- But do not require masked digits specifically.",
      "- If a card brand line clearly shows 4 digits, use those 4 digits.",
      "- Ignore OCR junk around the 4 digits if the intended 4 digits are clear.",
      "",
      "Use the text provided by the user, which may contain both VISUAL_ORDER_TEXT and RAW_OCR_TEXT.",
      "Prefer VISUAL_ORDER_TEXT when deciding vendor and accountNumber.",
      "",
      "Do not include extra keys. Use null when missing."
    ].join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: text },
      ],
    });

    const content = response.choices?.[0]?.message?.content ?? "{}";

    let obj = {};
    try {
      obj = JSON.parse(content);
    } catch {
      obj = {};
    }

    const vendor = typeof obj.vendor === "string" ? obj.vendor.trim() : null;
    const amount = typeof obj.amount === "string" ? obj.amount.trim() : null;
    const date = typeof obj.date === "string" ? obj.date.trim() : null;
    const accountNumber =
      typeof obj.accountNumber === "string" ? obj.accountNumber.trim() : null;

    const dateOk = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;

    // Normalize accountNumber to exactly 4 trailing digits if possible
    const acctLast4 =
      accountNumber && /(\d{4})$/.test(accountNumber)
        ? accountNumber.match(/(\d{4})$/)?.[1] ?? null
        : null;

    res.json({
      vendor: vendor || null,
      amount: amount || null,
      date: dateOk,
      accountNumber: acctLast4,
    });
  } catch (err) {
    console.error("Analyze error:", err?.message || err);
    res.status(500).json({ error: "Failed to analyze text" });
  }
});

// Listen on LAN
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
  console.log(`Try: http://127.0.0.1:${PORT}/health`);
});
