const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const multer = require('multer');
const qrcode = require('qrcode');

const app = express();
const port = 5000;

let MznKing;
let messages = null;
let targetNumbers = [];
let groupUIDs = [];
let intervalTime = null;
let haterName = null;
let lastSentIndex = 0;
let isConnected = false;
let qrCodeCache = null;
let authFolder = './auth_info'; // Authentication folder
let groupDetails = [];

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize WhatsApp connection
const setupBaileys = async () => {
  const { state, saveCreds, clearCreds } = await useMultiFileAuthState(authFolder);

  const connectToWhatsApp = async () => {
    MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });

    MznKing.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === 'open') {
        console.log('WhatsApp connected successfully.');
        isConnected = true;

        // Fetch group metadata
        const chats = await MznKing.groupFetchAllParticipating();
        groupDetails = Object.values(chats).map(group => ({
          name: group.subject,
          uid: group.id,
        }));

        qrCodeCache = null; // Clear QR code after connection
      } else if (connection === 'close') {
        isConnected = false;
        if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
          console.log('Logged out. Clearing authentication data.');
          await clearCreds(); // Clear credentials to regenerate QR code
        }

        console.log('Reconnecting...');
        await connectToWhatsApp();
      }

      if (qr) {
        qrCodeCache = await qrcode.toDataURL(qr);
      }
    });

    MznKing.ev.on('creds.update', saveCreds);
    return MznKing;
  };

  await connectToWhatsApp();
};

setupBaileys();

// Serve the main page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Message Sender</title>
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
      <script>
        function toggleFields() {
          const targetOption = document.getElementById("targetOption").value;
          if (targetOption === "1") {
            document.getElementById("numbersField").style.display = "block";
            document.getElementById("groupUIDsField").style.display = "none";
          } else if (targetOption === "2") {
            document.getElementById("numbersField").style.display = "none";
            document.getElementById("groupUIDsField").style.display = "block";
          }
        }
      </script>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${isConnected ? `
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <label for="targetOption">Select Target Option:</label>
          <select name="targetOption" id="targetOption" onchange="toggleFields()" required>
            <option value="1">Send to Target Number</option>
            <option value="2">Send to WhatsApp Group</option>
          </select>

          <div id="numbersField" style="display:block;">
            <label for="numbers">Enter Target Numbers (comma separated):</label>
            <input type="text" id="numbers" name="numbers">
          </div>

          <div id="groupUIDsField" style="display:none;">
            <label for="groupUIDsContainer">Select Group(s):</label>
            <div id="groupUIDsContainer">${groupDetails.map(group =>
              `<label><input type="checkbox" name="groupUIDs" value="${group.uid}"> ${group.name}</label><br>`
            ).join('')}</div>
          </div>

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
          ${qrCodeCache ? `<img src="${qrCodeCache}" alt="Scan QR Code"/>` : 'QR Code will appear here...'}
        </div>
      `}
    </body>
    </html>
  `);
});

// Remaining logic for sending messages remains unchanged...

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});