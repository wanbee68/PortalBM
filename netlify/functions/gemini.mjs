const MODEL_TEXT = "gemini-3.8-flash";
const MODEL_TTS = "gemini-3.8-flash-tts";
const PROMPT_GURU = "Anda ialah Cikgu AI, guru Bahasa Melayu yang ramah dan pakar. Jawab dalam Bahasa Melayu yang jelas dan sopan, sertakan contoh sesuai, dan galakkan murid belajar.";
const PROMPT_SEMAK = "Anda ialah pakar tatabahasa Bahasa Melayu. Analisis ayat murid dan pulangkan JSON sahaja dengan medan status (BETUL atau SALAH), penerangan, dan pembetulan. Berikan pembetulan yang sama dengan ayat asal jika ayat itu betul.";

const json = (body, statusCode = 200) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

async function callGemini(model, payload, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const text = result.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json({ error: "Kaedah permintaan tidak disokong." }, 405);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "Fungsi AI belum dikonfigurasi oleh pentadbir portal." }, 503);

  let input;
  try {
    if (!event.body || event.body.length > 60000) return json({ error: "Permintaan terlalu besar." }, 413);
    input = JSON.parse(event.body);
  } catch {
    return json({ error: "Data permintaan tidak sah." }, 400);
  }

  try {
    if (input.tindakan === "chat") {
      const kandungan = input.kandungan;
      if (!Array.isArray(kandungan) || kandungan.length < 1 || kandungan.length > 20) {
        return json({ error: "Sejarah perbualan tidak sah." }, 400);
      }
      const sah = kandungan.every((item) =>
        ["user", "model"].includes(item?.role) &&
        Array.isArray(item.parts) && item.parts.length === 1 &&
        typeof item.parts[0]?.text === "string" && item.parts[0].text.length <= 4000
      );
      if (!sah || kandungan.at(-1).role !== "user") return json({ error: "Mesej tidak sah." }, 400);

      const teks = await callGemini(MODEL_TEXT, {
        contents: kandungan,
        systemInstruction: { parts: [{ text: PROMPT_GURU }] },
        generationConfig: { thinkingConfig: { thinkingLevel: "low" } },
      }, apiKey);
      return json({ teks });
    }

    if (input.tindakan === "semak") {
      if (typeof input.ayat !== "string" || !input.ayat.trim() || input.ayat.length > 2000) {
        return json({ error: "Sila masukkan ayat sehingga 2,000 aksara." }, 400);
      }
      const raw = await callGemini(MODEL_TEXT, {
        contents: [{ role: "user", parts: [{ text: `Analisis ayat ini: ${input.ayat.trim()}` }] }],
        systemInstruction: { parts: [{ text: PROMPT_SEMAK }] },
        generationConfig: {
          thinkingConfig: { thinkingLevel: "low" },
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              status: { type: "STRING", enum: ["BETUL", "SALAH"] },
              penerangan: { type: "STRING" },
              pembetulan: { type: "STRING" },
            },
            required: ["status", "penerangan", "pembetulan"],
          },
        },
      }, apiKey);
      const data = JSON.parse(raw);
      if (!["BETUL", "SALAH"].includes(data.status)) throw new Error("Invalid grammar response");
      return json({ data });
    }

    if (input.tindakan === "tts") {
      if (typeof input.teks !== "string" || !input.teks.trim() || input.teks.length > 3000) {
        return json({ error: "Teks audio tidak sah atau terlalu panjang." }, 400);
      }
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model: MODEL_TTS,
          input: [{ type: "user_input", content: [{ type: "text", text: input.teks.trim(), annotations: [{ type: "speech_metadata", style: "mesra dan jelas seperti guru Bahasa Melayu" }] }] }],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: "Kore" }] },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Gemini TTS returned ${response.status}`);
      const audio = result.steps?.flatMap((step) => step.content || []).find((part) => part.type === "audio")?.data;
      if (!audio) throw new Error("Gemini returned no audio");
      return json({ audio });
    }

    return json({ error: "Tindakan tidak dikenali." }, 400);
  } catch (error) {
    console.error("Gemini function failed:", error.message);
    return json({ error: "Perkhidmatan AI tidak dapat memproses permintaan sekarang. Cuba lagi sebentar." }, 502);
  }
}

