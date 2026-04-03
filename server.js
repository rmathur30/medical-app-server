const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const OpenAI = require("openai");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const client = new OpenAI({
  apiKey: (process.env.OPENAI_API_KEY || "").trim()
});

const uploadsDir = path.join(__dirname, "uploads");
const framesDir = path.join(__dirname, "frames");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);

app.get("/", (req, res) => {
  res.send("Server is working!");
});

app.post("/upload-video", (req, res) => {
  const fileName = "video-" + Date.now() + ".mp4";
  const filePath = path.join(uploadsDir, fileName);

  console.log("UPLOAD STARTED:", fileName);

  const writeStream = fs.createWriteStream(filePath);

  req.on("end", () => {
    console.log("REQUEST ENDED");
  });

  req.on("error", (err) => {
    console.log("REQUEST ERROR:", err);
  });

  writeStream.on("finish", () => {
    console.log("WRITE FINISHED");
    res.send(fileName);
  });

  writeStream.on("error", (err) => {
    console.log("WRITE ERROR:", err);
    res.status(500).send("Upload failed");
  });

  req.pipe(writeStream);
});

function extractFrames(videoPath, videoId) {
  return new Promise((resolve, reject) => {
    const frameFolder = path.join(framesDir, path.parse(videoId).name);

    if (!fs.existsSync(frameFolder)) {
      fs.mkdirSync(frameFolder, { recursive: true });
    }

    for (const file of fs.readdirSync(frameFolder)) {
      fs.unlinkSync(path.join(frameFolder, file));
    }

    ffmpeg(videoPath)
      .outputOptions([
        "-vf fps=1",
        "-frames:v 5"
      ])
      .output(path.join(frameFolder, "frame-%02d.jpg"))
      .on("end", () => {
        console.log("FRAME EXTRACTION DONE");
        resolve(frameFolder);
      })
      .on("error", (err) => {
        console.log("FRAME EXTRACTION ERROR:", err);
        reject(err);
      })
      .run();
  });
}

app.post("/analyze-video", async (req, res) => {
  try {
    const { videoId } = req.body;

    console.log("ANALYZE BODY:", req.body);

    if (!videoId) {
      return res.status(400).json({ error: "No videoId received" });
    }

    const cleanVideoId = String(videoId).trim();
    const videoPath = path.join(uploadsDir, cleanVideoId);

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: "Video file not found" });
    }

    const frameFolder = await extractFrames(videoPath, cleanVideoId);

    const frameFiles = fs.readdirSync(frameFolder)
      .filter((f) => f.endsWith(".jpg"))
      .sort();

    if (frameFiles.length === 0) {
      return res.status(500).json({ error: "No frames were created" });
    }

   

const content = [
  {
    type: "input_text",
    text: `
You are an emergency medical triage assistant.

Your job is to quickly assess what may be happening and give CLEAR, DIRECT, step-by-step care instructions.

IMPORTANT RULES:
- Be decisive and action-oriented
- Prioritize safety and immediate care
- Do NOT give long explanations
- Focus on WHAT TO DO next
- If this could be serious, treat it as urgent

PROCESS:

1. Determine if this is an EMERGENCY
2. Identify the most likely issue based on visible signs
3. Give immediate, practical steps

OUTPUT FORMAT (STRICT):

EMERGENCY LEVEL:
- Emergency / Urgent / Non-urgent

WHAT MAY BE HAPPENING:
- (1–2 short lines max)

WHAT TO DO RIGHT NOW:
1. ...
2. ...
3. ...
4. ...
5. ...

IMPORTANT NOTES:
- (only critical warnings)

FINAL REMINDER:
If symptoms are severe, worsening, or unclear, seek medical care immediately.
`
  }
];








    for (const fileName of frameFiles) {
      const filePath = path.join(frameFolder, fileName);
      const base64 = fs.readFileSync(filePath, "base64");

      content.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${base64}`
      });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: content
        }
      ],
      temperature: 0.2
    });

    res.send(response.output_text);
  } catch (error) {
    console.error("ANALYZE ERROR:", error);
    res.status(500).send(error.message || "Analyze failed");
  }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
