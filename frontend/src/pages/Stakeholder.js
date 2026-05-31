import React, { useState, useEffect, useCallback } from "react";
import { Container, Card, Form, Button, Alert, Spinner, Table } from "react-bootstrap";
import { Link } from "react-router-dom";
import web3 from "../utils/web3";
import contract from "../utils/contract";
import axios from "axios";
import "../styles/theme.css";

// Helper: hex string → Uint8Array (browser-compatible, no Buffer)
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

function Stakeholder() {
    const [account, setAccount] = useState("");
    const [userInfo, setUserInfo] = useState(null);
    const [message, setMessage] = useState("");

    // Registration
    const [orgName, setOrgName] = useState("");
    const [orgType, setOrgType] = useState("");
    const [registering, setRegistering] = useState(false);

    // Hospitals and patients
    const [hospitals, setHospitals] = useState([]);
    const [selectedHospital, setSelectedHospital] = useState("");
    const [patientsWithNames, setPatientsWithNames] = useState([]);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [patientRecords, setPatientRecords] = useState([]);
    const [loadingHospitals, setLoadingHospitals] = useState(false);
    const [loadingPatients, setLoadingPatients] = useState(false);
    const [loadingRecords, setLoadingRecords] = useState(false);

    // pendingConsentRecords: persistent – records where this stakeholder already
    // sent a request but the patient hasn't responded yet
    const [pendingConsentRecords, setPendingConsentRecords] = useState(new Set());
    // grantedConsentRecords: persistent – records where consent was already given
    const [grantedConsentRecords, setGrantedConsentRecords] = useState(new Set());
    // consentTxInFlight: temporary loading indicator while the tx is being sent
    const [consentTxInFlight, setConsentTxInFlight] = useState(new Set());

    useEffect(() => {
        const loadAccount = async () => {
            const accounts = await web3.eth.getAccounts();
            if (accounts.length > 0) setAccount(accounts[0]);
        };
        loadAccount();
        if (window.ethereum) {
            window.ethereum.on("accountsChanged", (accounts) => {
                setAccount(accounts.length > 0 ? accounts[0] : "");
            });
        }
    }, []);

    const checkRegistration = useCallback(async () => {
        if (!account) return;
        try {
            const user = await contract.methods.users(account).call();
            if (user.registered) {
                setUserInfo({
                    ...user,
                    role: Number(user.role),
                    hospitalId: Number(user.hospitalId)
                });
            } else {
                setUserInfo(null);
            }
        } catch (err) {
            console.warn("Error checking registration:", err);
            setUserInfo(null);
        }
    }, [account]);

    useEffect(() => {
        checkRegistration();
    }, [checkRegistration]);

    const fetchHospitals = useCallback(async () => {
        setLoadingHospitals(true);
        try {
            const hospitalCount = await contract.methods.hospitalCounter().call();
            const list = [];
            for (let i = 1; i <= hospitalCount; i++) {
                const h = await contract.methods.hospitals(i).call();
                list.push({ id: Number(i), name: h.name });
            }
            setHospitals(list);
        } catch (err) {
            console.error("Error fetching hospitals:", err);
        } finally {
            setLoadingHospitals(false);
        }
    }, []);

    useEffect(() => {
        if (userInfo && userInfo.role === 4) {
            fetchHospitals();
        }
    }, [userInfo, fetchHospitals]);

    const registerStakeholder = async () => {
        if (!orgName || !orgType) {
            setMessage("Please enter organization name and type");
            return;
        }
        setRegistering(true);
        try {
            setMessage("Registering...");
            await contract.methods.registerStakeholder(orgName).send({
                from: account,
                gas: 3000000
            });
            setMessage(`✅ Registered as ${orgType}: ${orgName}`);
            await checkRegistration();
        } catch (err) {
            setMessage("Registration failed: " + err.message);
        } finally {
            setRegistering(false);
        }
    };

    const handleHospitalSelect = async (hospitalId) => {
        setSelectedHospital(hospitalId);
        setSelectedPatient(null);
        setPatientRecords([]);
        setLoadingPatients(true);
        try {
            const patientList = await contract.methods.getHospitalPatients(hospitalId).call();
            const withNames = await Promise.all(patientList.map(async addr => {
                const user = await contract.methods.users(addr).call();
                return { addr, name: user.name };
            }));
            setPatientsWithNames(withNames);
        } catch (err) {
            console.error("Error fetching patients:", err);
        } finally {
            setLoadingPatients(false);
        }
    };

    const handlePatientSelect = async (patientAddr) => {
        setSelectedPatient(patientAddr);
        setLoadingRecords(true);
        // Clear stale consent state when switching to a new patient
        setPendingConsentRecords(new Set());
        setGrantedConsentRecords(new Set());
        try {
            const recordIds = await contract.methods.getPatientRecords(patientAddr).call();
            const records = await Promise.all(recordIds.map(async id => {
                const idNum = Number(id);
                const rec = await contract.methods.records(idNum).call();
                return {
                    id: idNum,
                    hospitalId: Number(rec.hospitalId),
                    ipfsHash: rec.ipfsHash,
                    timestamp: Number(rec.timestamp)
                };
            }));
            setPatientRecords(records);

            // Check on-chain consent status for every record so the button
            // shows the correct persistent state immediately on load.
            const pending = new Set();
            const granted = new Set();
            await Promise.all(records.map(async rec => {
                const alreadyGranted = await contract.methods.consentGiven(rec.id, account).call();
                if (alreadyGranted) {
                    granted.add(rec.id);
                    return;
                }
                const alreadyRequested = await contract.methods.consentRequested(rec.id, account).call();
                if (alreadyRequested) {
                    pending.add(rec.id);
                }
            }));
            setPendingConsentRecords(pending);
            setGrantedConsentRecords(granted);
        } catch (err) {
            setMessage("Error loading records: " + err.message);
        } finally {
            setLoadingRecords(false);
        }
    };

    // Download an IPFS record after consent has been granted (Tier 4).
    // Mirrors the same decrypt-then-download pattern used by Doctor and Hospital.
    const downloadRecord = async (recordId, ipfsHash) => {
        try {
            let encryptedResp;
            try {
                encryptedResp = await axios.get(`http://localhost:8080/ipfs/${ipfsHash}`, {
                    responseType: "arraybuffer",
                    timeout: 5000
                });
            } catch (localErr) {
                console.warn("Local IPFS gateway failed, trying public gateway", localErr);
                encryptedResp = await axios.get(`https://ipfs.io/ipfs/${ipfsHash}`, {
                    responseType: "arraybuffer"
                });
            }
            const encryptedData = new Uint8Array(encryptedResp.data);

            const keyResp = await axios.get(`http://localhost:5001/get-key/${recordId}/${account}`);
            if (!keyResp.data.success) {
                setMessage("❌ Key retrieval failed: not authorized");
                return;
            }
            const key = hexToBytes(keyResp.data.key);

            const iv = encryptedData.slice(0, 16);
            const ciphertext = encryptedData.slice(16);

            const cryptoKey = await window.crypto.subtle.importKey(
                "raw", key, { name: "AES-CBC" }, false, ["decrypt"]
            );
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-CBC", iv }, cryptoKey, ciphertext
            );

            const blob = new Blob([decrypted]);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `record_${recordId}.bin`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            setMessage("✅ File downloaded successfully.");
        } catch (err) {
            console.error("Download error:", err);
            setMessage("Error downloading record: " + err.message);
        }
    };

    const requestAccess = async (recordId) => {
        setConsentTxInFlight(prev => new Set(prev).add(recordId));
        try {
            // Client-side pre-checks to avoid wasting gas on obvious failures
            const alreadyGranted = await contract.methods.consentGiven(recordId, account).call();
            if (alreadyGranted) {
                setGrantedConsentRecords(prev => new Set(prev).add(recordId));
                setMessage("ℹ️ Consent already granted for this record.");
                return;
            }
            const alreadyRequested = await contract.methods.consentRequested(recordId, account).call();
            if (alreadyRequested) {
                setPendingConsentRecords(prev => new Set(prev).add(recordId));
                setMessage("ℹ️ Consent already requested – waiting for patient approval.");
                return;
            }

            await contract.methods.requestConsent(recordId).send({ from: account, gas: 300000 });

            // Mark as pending persistently so the button stays "⏳ Pending"
            // even after the component re-renders.
            setPendingConsentRecords(prev => new Set(prev).add(recordId));
            setMessage("✅ Access request sent! The patient will see a notification in their dashboard.");
        } catch (err) {
            console.error("Request error:", err);
            let reason = err.message;
            if (err.data && err.data.message) reason = err.data.message;
            if (reason.includes("Consent already given")) {
                setGrantedConsentRecords(prev => new Set(prev).add(recordId));
                setMessage("ℹ️ Consent already granted for this record.");
            } else {
                setMessage("❌ Request failed: " + reason);
            }
        } finally {
            setConsentTxInFlight(prev => {
                const next = new Set(prev);
                next.delete(recordId);
                return next;
            });
        }
    };

    if (!userInfo) {
        return (
            <Container className="mt-4">
                <h2 className="hero-title">Stakeholder Registration</h2>
                <p className="hero-subtitle">Connected as: {account}</p>
                {message && <Alert variant="info" dismissible onClose={() => setMessage("")}>{message}</Alert>}
                <Card className="card-custom">
                    <Card.Body>
                        <Form>
                            <Form.Group className="mb-3">
                                <Form.Label>Organization Name</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={orgName}
                                    onChange={e => setOrgName(e.target.value)}
                                    placeholder="e.g., MediData Research"
                                />
                            </Form.Group>
                            <Form.Group className="mb-3">
                                <Form.Label>Organization Type</Form.Label>
                                <Form.Select value={orgType} onChange={e => setOrgType(e.target.value)}>
                                    <option value="">-- Select Type --</option>
                                    <option value="Insurance">Insurance Company</option>
                                    <option value="Research">Research Organization</option>
                                </Form.Select>
                            </Form.Group>
                            <Button
                                className="btn-medical"
                                onClick={registerStakeholder}
                                disabled={registering}
                            >
                                {registering ? "Registering..." : "Register"}
                            </Button>
                        </Form>
                    </Card.Body>
                </Card>
                <Link to="/" className="btn btn-link mt-3" style={{ color: 'cyan' }}>← Back to Home</Link>
            </Container>
        );
    }

    if (userInfo.role !== 4) {
        return (
            <Container className="mt-4">
                <Alert variant="warning">This account is not a stakeholder. Please use a stakeholder account.</Alert>
                <Link to="/" className="btn btn-link mt-3" style={{ color: 'cyan' }}>← Back to Home</Link>
            </Container>
        );
    }

    return (
        <Container className="mt-4">
            <div className="card-custom mb-4">
                <h2>Stakeholder Dashboard</h2>
                <p><strong>{orgType}: {userInfo.name}</strong></p>
                <p>Connected as: {account}</p>
                {message && <Alert variant="info" dismissible onClose={() => setMessage("")}>{message}</Alert>}
            </div>

            <Card className="card-custom">
                <Card.Body>
                    <Card.Title>Select a Hospital</Card.Title>
                    {loadingHospitals ? (
                        <Spinner animation="border" size="sm" />
                    ) : (
                        <Form.Select
                            value={selectedHospital}
                            onChange={e => handleHospitalSelect(e.target.value)}
                        >
                            <option value="">-- Choose Hospital --</option>
                            {hospitals.map(h => (
                                <option key={h.id} value={h.id}>{h.name}</option>
                            ))}
                        </Form.Select>
                    )}

                    {selectedHospital && (
                        <>
                            <h5 className="mt-4">Patients at this hospital</h5>
                            {loadingPatients ? (
                                <Spinner size="sm" />
                            ) : patientsWithNames.length > 0 ? (
                                <Table striped bordered hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>Patient</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patientsWithNames.map(p => (
                                            <tr key={p.addr}>
                                                <td>
                                                    {p.addr}<br/>
                                                    <small className="text-muted">{p.name}</small>
                                                </td>
                                                <td>
                                                    <Button
                                                        size="sm"
                                                        variant="info"
                                                        onClick={() => handlePatientSelect(p.addr)}
                                                    >
                                                        View Records
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            ) : (
                                <p>No patients at this hospital.</p>
                            )}
                        </>
                    )}

                    {selectedPatient && (
                        <>
                            <h5 className="mt-4">Records for {selectedPatient}</h5>
                            {loadingRecords ? (
                                <Spinner size="sm" />
                            ) : patientRecords.length > 0 ? (
                                <Table size="sm" striped bordered>
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Hospital</th>
                                            <th>Timestamp</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patientRecords.map(rec => (
                                            <tr key={rec.id}>
                                                <td>{rec.id}</td>
                                                <td>{rec.hospitalId}</td>
                                                <td>{new Date(rec.timestamp * 1000).toLocaleString()}</td>
                                                <td>
                                                    {/* Request Access button – disabled once pending or granted */}
                                                    <Button
                                                        size="sm"
                                                        variant={
                                                            grantedConsentRecords.has(rec.id) ? "success" :
                                                            pendingConsentRecords.has(rec.id) ? "secondary" :
                                                            "warning"
                                                        }
                                                        className="me-1"
                                                        disabled={
                                                            consentTxInFlight.has(rec.id) ||
                                                            pendingConsentRecords.has(rec.id) ||
                                                            grantedConsentRecords.has(rec.id)
                                                        }
                                                        onClick={() => requestAccess(rec.id)}
                                                    >
                                                        {consentTxInFlight.has(rec.id) ? "Sending…" :
                                                         grantedConsentRecords.has(rec.id) ? "✓ Granted" :
                                                         pendingConsentRecords.has(rec.id) ? "⏳ Pending" :
                                                         "Request Access"}
                                                    </Button>
                                                    {/* Download button – only shown after consent is granted */}
                                                    {grantedConsentRecords.has(rec.id) && (
                                                        <Button
                                                            size="sm"
                                                            variant="primary"
                                                            onClick={() => downloadRecord(rec.id, rec.ipfsHash)}
                                                        >
                                                            Download
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            ) : (
                                <p>No records for this patient.</p>
                            )}
                        </>
                    )}
                </Card.Body>
            </Card>

            <Link to="/" className="btn btn-link mt-3" style={{ color: 'cyan' }}>← Back to Home</Link>
        </Container>
    );
}

export default Stakeholder;