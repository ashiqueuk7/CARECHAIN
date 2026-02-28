# CareChain – Blockchain-Based Medical Record Exchange System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Ethereum](https://img.shields.io/badge/Ethereum-3C3C3D?logo=ethereum&logoColor=white)](https://ethereum.org/)
[![Solidity](https://img.shields.io/badge/Solidity-363636?logo=solidity&logoColor=white)](https://soliditylang.org/)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![IPFS](https://img.shields.io/badge/IPFS-65C2CB?logo=ipfs&logoColor=white)](https://ipfs.tech/)

---

## 📌 Overview

**CareChain** is a decentralized platform for secure, patient-centric sharing of medical records across healthcare institutions.  

It leverages:

- 🔗 **Blockchain (Ethereum)** for immutable audit trails  
- 📁 **IPFS** for decentralized file storage  
- 🔐 **Smart Contracts** for consent automation  
- 🧑‍⚕️ **Three-Tier Access Control** for balancing privacy and emergency needs  

The system ensures that **patients remain in full control of their medical data** while enabling secure and timely access for healthcare providers.

---

## ✨ Key Features

- **Patient-Centric Control** – Patients grant and revoke access.
- **Three-Tier Access Model**:
  - **Tier 1** – Automatic access within same hospital
  - **Tier 2** – Explicit patient consent for cross-hospital access
  - **Tier 3** – Emergency break-glass access (time-limited)
- **Hybrid Storage Architecture**
  - On-chain metadata
  - Off-chain encrypted medical files
- **Immutable Audit Logs**
- **Role-Based Dashboards**
- **End-to-End Encryption (AES-256)**

---

## 🏗️ System Architecture

```
┌───────────────────────────────────────────────┐
│ Frontend (React.js)                          │
│  • Patient Dashboard                         │
│  • Doctor Dashboard                          │
│  • Hospital Admin Dashboard                  │
└───────────────────────┬───────────────────────┘
                        │ Web3 / MetaMask
                        ▼
┌───────────────────────────────────────────────┐
│ Smart Contracts (Solidity)                   │
│  • UserRegistry                              │
│  • RecordManager                             │
│  • ConsentManager                            │
│  • EmergencyAccess                           │
│  • AuditLog                                  │
└───────────────┬───────────────────────────────┘
                │
                ▼
┌──────────────────────────────┐
│ Backend (Node.js + Express)  │
│  • AES-256 Encryption        │
│  • IPFS Upload               │
│  • Key Management            │
└───────────────┬──────────────┘
                ▼
        IPFS (Encrypted Files)
```

---

## 🛠️ Technology Stack

| Layer | Technology |
|-------|------------|
| Blockchain | Ethereum (Ganache) |
| Smart Contracts | Solidity 0.8.20, Hardhat |
| Storage | IPFS |
| Backend | Node.js, Express, Web3.js |
| Frontend | React.js, Bootstrap |
| Encryption | AES-256-CBC |
| Authentication | MetaMask |

---

## 📁 Project Structure

```
CareChain/
│
├── blockchain/
│   ├── contracts/
│   ├── scripts/
│   ├── test/
│   ├── hardhat.config.js
│   └── package.json
│
├── backend/
│   ├── server.js
│   ├── uploads/
│   └── package.json
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── abis/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── utils/
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
│
├── README.md
└── .gitignore
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- MetaMask
- Ganache OR Hardhat Node
- IPFS installed and running

---

### 1️⃣ Clone Repository

```bash
git clone https://github.com/yourusername/CareChain.git
cd CareChain
```

---

### 2️⃣ Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install

# Blockchain
cd ../blockchain
npm install
```

---

### 3️⃣ Start Services

#### Terminal 1 – Start IPFS

```bash
ipfs daemon
```

#### Terminal 2 – Start Local Blockchain

```bash
cd blockchain
npx hardhat node
```

#### Terminal 3 – Deploy Smart Contract

```bash
npx hardhat run scripts/deploy.js --network localhost
```

#### Terminal 4 – Start Backend

```bash
cd backend
node server.js
```

#### Terminal 5 – Start Frontend

```bash
cd frontend
npm start
```

Open:

```
http://localhost:3000
```

Connect MetaMask to:

```
http://localhost:8545
```

---

## 📄 License

Distributed under the MIT License.

---

## 📬 Contact

**Muhammed Ashique U K**  
MCA – Government Engineering College, Thrissur  
Blockchain & AI Enthusiast
