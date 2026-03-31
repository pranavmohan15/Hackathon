const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/assistant", async (req, res) => {
  try {
    const { routeContext, systemPrompt, model } = req.body || {};
    const geminiKey = process.env.GEMINI_KEY;

    if (!geminiKey) {
      return res.status(200).json({
        text: "I am ready to help! Add your Gemini API key in server/.env to enable live AI responses.",
      });
    }

    const selectedModel = model || process.env.GEMINI_MODEL || "gemini-2.0-flash-latest";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt || "" }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: routeContext || "" }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 220,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(500).json({ error: "gemini_error", details: err });
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "I am checking nearby options for you.";

    return res.status(200).json({ text });
  } catch (_error) {
    return res.status(500).json({ error: "server_error" });
  }
});

app.listen(PORT, () => {
  console.log(`SNA server running on http://localhost:${PORT}`);
});

