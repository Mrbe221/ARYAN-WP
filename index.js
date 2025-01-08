const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const multer = require('multer');
const qrcode = require('qrcode');

const app = express();
const port = 5000;

let activeConnections = {}; // Store connections per user
let qrCodes = {}; // Store QR codes for each user

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize WhatsApp connection for a specific user
const setupBaileys = async (userId) => {
  const authPath = `./auth_info_${userId}`;
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const connectToWhatsApp = async () => {
    const MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });

    activeConnections[userId] = MznKing;

    MznKing.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === 'open') {
        console.log(`User ${userId} connected successfully.`);
        qrCodes[userId] = null; // Clear QR code once connected
      } else if (connection === 'close' && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log(`Reconnecting user ${userId}...`);
          await connectToWhatsApp();
        } else {
          console.log(`User ${userId} logged out.`);
          delete activeConnections[userId];
        }
      }

      if (qr) {
        qrCodes[userId] = await qrcode.toDataURL(qr); // Generate QR code for the user
      }
    });

    MznKing.ev.on('creds.update', saveCreds);
    return MznKing;
  };

  return connectToWhatsApp();
};

// Serve the main page
app.get('/:userId', async (req, res) => {
  const userId = req.params.userId;

  // Initialize connection if not already
  if (!activeConnections[userId]) {
    await setupBaileys(userId);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Sender - User ${userId}</title>
      <style>
        body { font-family: Arial, sans-serif; background-color: #f0f0f0; color: #333; }
        h1 { text-align: center; color: #4CAF50; }
        #qrCodeBox { width: 200px; height: 200px; margin: 20px auto; display: flex; justify-content: center; align-items: center; border: 2px solid #4CAF50; }
        #qrCodeBox img { width: 100%; height: 100%; }
        form { margin: 20px auto; max-width: 500px; padding: 20px; background: white; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        input, select, button { width: 100%; margin: 10px 0; padding: 10px; border-radius: 5px; border: 1px solid #ccc; }
        button { background-color: #4CAF50; color: white; border: none; cursor: pointer; }
        button:hover { background-color: #45a049; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Sender - User ${userId}</h1>
      ${activeConnections[userId] ? `
        <form action="/send-messages/${userId}" method="post" enctype="multipart/form-data">
          <label for="targetOption">Select Target Option:</label>
          <select name="targetOption" id="targetOption" required>
            <option value="1">Send to Target Number</option>
            <option value="2">Send to WhatsApp Group</option>
          </select>

          <label for="numbers">Enter Target Numbers (comma separated):</label>
          <input type="text" id="numbers" name="numbers">

          <label for="messageFile">Upload Your Message File:</label>
          <input type="file" id="messageFile" name="messageFile" required>

          <label for="haterNameInput">Enter Hater's Name:</label>
          <input type="text" id="haterNameInput" name="haterNameInput" required>

          <label for="delayTime">Enter Message Delay (in seconds):</label>
          <input type="number" id="delayTime" name="delayTime" required>

          <button type="submit">Start Sending Messages</button>
        </form>
      ` : `
        <h2>Scan this QR code to connect WhatsApp</h2>
        <div id="qrCodeBox">
          ${qrCodes[userId] ? `<img src="${qrCodes[userId]}" alt="Scan QR Code"/>` : 'QR Code will appear here...'}
        </div>
      `}
    </body>
    </html>
  `);
});

// Message sending logic
app.post('/send-messages/:userId', upload.single('messageFile'), async (req, res) => {
  const userId = req.params.userId;
  const MznKing = activeConnections[userId];

  if (!MznKing) {
    res.status(400).send({ status: 'error', message: 'User not connected to WhatsApp.' });
    return;
  }

  try {
    const { targetOption, numbers, delayTime, haterNameInput } = req.body;

    const messageContent = req.file.buffer.toString('utf-8').split('\n').filter(Boolean);
    const targets = targetOption === "1" ? numbers.split(',') : []; // Adjust logic for groups

    for (const target of targets) {
      for (const msg of messageContent) {
        await MznKing.sendMessage(`${target}@c.us`, { text: `${haterNameInput} ${msg}` });
        await delay(parseInt(delayTime) * 1000);
      }
    }

    res.send({ status: 'success', message: 'Messages sent successfully.' });
  } catch (error) {
    res.status(500).send({ status: 'error', message: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
