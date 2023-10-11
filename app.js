const express = require('express')
const { google } = require("googleapis");
const OAuth2Client = google.auth.OAuth2;
const nodemailer = require("nodemailer");
const multer = require("multer");
require("dotenv").config();
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const app = express()
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

let refresh_token = null; // Store the refresh token here
const users = {}; // In-memory database to store user information and tokens
const pdfs = {}; // In-memory database to store uploaded PDFs

// Nodemailer setup using the user's credentials

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json()); // Enable JSON request body parsing
app.use(cors({
  origin: 'https://recruitm-front.vercel.app',
}));

app.get("/signup", (req, res) => {
  // Redirect the user to Google's OAuth consent page
  const scopes = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://mail.google.com/",
  ];
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline", // 'offline' to get a refresh token
    scope: scopes,
  });
  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  try {
    // Exchange the authorization code for access and refresh tokens
    const { tokens } = await oauth2Client.getToken(code);
    console.log("token:", tokens);
    oauth2Client.setCredentials(tokens);

    // Use the access token to get the user's email address
    const userInfo = await getUserEmail();
    console.log("tokens.access_token::::", tokens.access_token);
    console.log(userInfo);

    // Generate a unique identifier for the user
    const userId = uuidv4();

    // Store user information and tokens in the in-memory database
    users[userId] = {
      userInfo,
      tokens,
    };

    // Redirect the user to the front-end with the generated identifier
    res.redirect(`${process.env.page1}?userId=${userId}`);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error during authentication or sending email.");
  }
});

// API to upload PDFs with user details
app.post("/upload-pdf/:userId", upload.single("pdf"), async (req, res) => {
  console.log('nere le bg ')
  try {
    const userId = req.params.userId;
    const user = users[userId];

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const { userInfo } = user;

    const pdfFile = req.file;

    if (!pdfFile || pdfFile.mimetype !== "application/pdf") {
      return res
        .status(400)
        .json({ success: false, message: "Please upload a valid PDF file." });
    }

    // Store the uploaded PDF in the in-memory database
    const pdfId = uuidv4();
    pdfs[pdfId] = {
      userId,
      pdfData: pdfFile.buffer,
      fileName: pdfFile.originalname,
    };

    res.status(200).json({
      success: true,
      pdfId,
      message: "PDF uploaded successfully!",
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: "Error uploading PDF." });
  }
});


// API to send emails with PDF attachments
app.post("/send-email/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = users[userId];

    if (!user) {
      return res.status(404).send("User not found");
    }

    const { userInfo, tokens } = user;
    const { recipientEmails, pdfIds } = req.body;

    // Create a Nodemailer transporter with user's credentials
    let transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        user: userInfo.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      },
    });

    const attachments = [];

    // Attach the specified PDFs
    pdfIds.forEach((pdfId) => {
      const pdf = pdfs[pdfId];

      if (pdf && pdf.userId === userId) {
        attachments.push({
          filename: pdf.fileName,
          content: pdf.pdfData,
        });
      }
    });

    // Define email content
    const mailOptions = {
      from: userInfo.email,
      to: recipientEmails.join(", "), // Join recipient emails with a comma
      subject: "Email with PDF Attachments",
      text: "Here are your PDF attachments.",
      attachments: attachments,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    res.send("Email with PDF attachments sent successfully!");
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error sending email with PDF attachments.");
  }
});

async function getUserEmail() {
  const oauth2 = google.oauth2({
    auth: oauth2Client,
    version: "v2",
  });

  const { data } = await oauth2.userinfo.get();
  return data;
}
app.listen(process.env.PORT || 3000)