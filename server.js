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

// ---- ROUTES (must exist) ----

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

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You extract fields from receipt/deposit/payment OCR text.",
            "Return ONLY a JSON object with keys:",
            "vendor (string or null), amount (string or null), date (YYYY-MM-DD or null), accountNumber (string or null).",
            "accountNumber: ONLY return if you see a masked account/card pattern like ***********1234 or ************1234 or 			    xxxxxxxxxxx1234 or xxxxxxxxxxxx1234.",
            "Return the last 4 digits only (e.g., '1234').",
            "If you do not see masked digits, return null. Do not guess.",
            "Do not include extra keys. Use null when missing.",
            "If multiple totals exist, choose the most likely final total."
          ].join(" "),
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

    // Normalize accountNumber to last 4 digits if the model returns extra
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