const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
const { create } = require("ipfs-http-client");
const { Web3 } = require("web3");
const contractABI = require("../frontend/src/abis/CareChain.json");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// IPFS client (local node on port 5002)
const ipfs = create({ url: "http://127.0.0.1:5002" });

// Blockchain connection
const web3 = new Web3("http://127.0.0.1:8545"); // Ganache
const contractAddress = "0x54672a239f4a1488C4668eF59d242c0fcFF965e9"; // <-- REPLACE with your deployed contract address

let abi = contractABI.abi || contractABI;
const contract = new web3.eth.Contract(abi, contractAddress);

// In-memory key store (recordId => key)
const keys = new Map();

// Helper: check if requester is authorized for a record by calling contract
async function isAuthorized(recordId, requester) {
    try {
        const record = await contract.methods.records(recordId).call();
        if (!record || record.id == 0) return false;

        // Patient themselves
        if (requester.toLowerCase() === record.patient.toLowerCase()) return true;

        const user = await contract.methods.users(requester).call();
        if (!user.registered) return false;

        const role = Number(user.role);
        const hospitalId = Number(user.hospitalId);

        // Same‑hospital doctor or admin
        if ((role === 2 || role === 3) && hospitalId === Number(record.hospitalId)) return true;

        // Consent given
        const consent = await contract.methods.consentGiven(recordId, requester).call();
        if (consent) return true;

        // Emergency access
        const expiry = await contract.methods.emergencyAccess(requester, recordId).call();
        if (Number(expiry) > Math.floor(Date.now() / 1000)) return true;

        return false;
    } catch (err) {
        console.error("Authorization check error:", err);
        return false;
    }
}

// Encrypt file using AES-256-CBC
// Encrypt file using AES-256-CBC and prepend IV
function encryptFile(buffer) {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    // Prepend IV to encrypted data
    const ivAndCiphertext = Buffer.concat([iv, encrypted]);
    return { encrypted: ivAndCiphertext, key };
}

// ... (rest of the file remains same)

// Upload endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const fileBuffer = fs.readFileSync(req.file.path);
        const { encrypted, key } = encryptFile(fileBuffer);

        const result = await ipfs.add(encrypted);
        const ipfsHash = result.path;
        console.log(`✅ File uploaded to IPFS: ${ipfsHash}`);

        // Store key temporarily under IPFS hash
        keys.set(ipfsHash, key);
        console.log(`🔑 Key stored for IPFS hash: ${ipfsHash}`);

        fs.unlinkSync(req.file.path);

        res.json({ success: true, ipfsHash });
    } catch (err) {
        console.error("Upload Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Associate recordId with key after on-chain creation
app.post("/associate-key", express.json(), (req, res) => {
    const { ipfsHash, recordId } = req.body;
    console.log(`🔗 Associate-key request: ipfsHash=${ipfsHash}, recordId=${recordId}`);

    if (!keys.has(ipfsHash)) {
        console.log(`❌ Key not found for IPFS hash: ${ipfsHash}`);
        return res.status(404).json({ success: false, message: "Key not found for this IPFS hash" });
    }
    const key = keys.get(ipfsHash);
    keys.delete(ipfsHash);
    keys.set(recordId, key);
    console.log(`✅ Key associated: recordId=${recordId}`);
    res.json({ success: true });
});

// Get decryption key for authorized requester
app.get("/get-key/:recordId/:account", async (req, res) => {
    const { recordId, account } = req.params;
    console.log(`🔑 Key request for record ${recordId} by ${account}`);

    const authorized = await isAuthorized(recordId, account);
    console.log(`Authorization result: ${authorized}`);

    if (!authorized) {
        return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const key = keys.get(recordId);
    if (!key) {
        console.log(`❌ Key not found for record ${recordId}`);
        return res.status(404).json({ success: false, message: "Key not found" });
    }

    res.json({ success: true, key: key.toString("hex") });
});

// Optional debug endpoint (remove in production)
app.get("/debug/keys", (req, res) => {
    const allKeys = Array.from(keys.entries()).map(([k, v]) => ({ 
        id: k, 
        keyLength: v.length 
    }));
    res.json(allKeys);
});

app.listen(5001, () => {
    console.log("🚀 Backend running on port 5001");
});