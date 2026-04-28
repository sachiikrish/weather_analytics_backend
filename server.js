const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(cors({
  origin: "https://weather-analytics-frontend.vercel.app",
}));
app.use(express.json());

// ─── Axios instance for ThingSpeak ───────────────────────────────────────────
const thingspeakClient = axios.create({
  baseURL: "https://api.thingspeak.com",
  timeout: 8000, // 8s timeout — ThingSpeak can be slow
});

// ─── MongoDB Connection ───────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Atlas connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ─── Weather Schema ───────────────────────────────────────────────────────────
const weatherSchema = new mongoose.Schema({
  temperature: Number,
  humidity: Number,
  createdAt: { type: Date, default: Date.now },
});
const Weather = mongoose.model("Weather", weatherSchema);

// ─── Helper: Generate Random Weather Data ────────────────────────────────────
function generateWeatherData() {
  const temperature = parseFloat((Math.random() * (35 - 20) + 20).toFixed(2));
  const humidity    = parseFloat((Math.random() * (80 - 40) + 40).toFixed(2));
  return { temperature, humidity };
}

// ─── Helper: Send to ThingSpeak via Axios ────────────────────────────────────
async function sendToThingSpeak(temperature, humidity) {
     const apiKey = process.env.THINGSPEAK_WRITE_KEY;
 
  // Guard: skip if key is missing or still a placeholder
  if (!apiKey || apiKey === "YOUR_THINGSPEAK_WRITE_KEY_HERE") {
    console.warn("⚠ THINGSPEAK_WRITE_KEY not set in .env — skipping ThingSpeak push");
    return 0;
  }
  try {
    const response = await thingspeakClient.get("/update", {
      params: {
        api_key: process.env.THINGSPEAK_WRITE_KEY,
        field1: temperature,
        field2: humidity,
      },
    });
    // ThingSpeak returns entry ID as plain number (0 = failed/rate-limited)
    const entryId = response.data;
    if (entryId === 0) {
      console.warn("⚠ ThingSpeak returned 0 — possibly rate limited (min 15s between updates)");
    } else {
      console.log(`📡 ThingSpeak entry ID: ${entryId}`);
    }
    return entryId;
  } catch (err) {
    console.error("❌ ThingSpeak axios error:", err.message);
    throw new Error(`ThingSpeak request failed: ${err.message}`);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Weather API is running 🚀" });
});

// Core route — generates data, saves to DB, sends to ThingSpeak
app.get("/generate-weather", async (req, res) => {
  try {
    const { temperature, humidity } = generateWeatherData();

    // 1. Save to MongoDB
    const record = new Weather({ temperature, humidity });
    await record.save();
    console.log(`💾 Saved: ${temperature}°C, ${humidity}%`);

    // 2. Push to ThingSpeak via axios
    const tsEntry = await sendToThingSpeak(temperature, humidity);

    // 3. Return to frontend
    res.json({
      success: true,
      data: {
        temperature,
        humidity,
        savedAt: record.createdAt,
        thingspeakEntryId: tsEntry,
      },
    });
  } catch (err) {
    console.error("❌ Error in /generate-weather:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Last 10 readings from MongoDB
app.get("/history", async (req, res) => {
  try {
    const records = await Weather.find().sort({ createdAt: -1 }).limit(10);
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
