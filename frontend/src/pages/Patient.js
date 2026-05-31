import React, { useState, useEffect, useCallback } from "react";
import { Container, Table, Button, Form, Alert, Card, Spinner, Tabs, Tab } from "react-bootstrap";
import web3 from "../utils/web3";
import contract from "../utils/contract";
import axios from "axios";
import "../styles/theme.css";

// Helper: hex to bytes
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

function Patient() {
    const [account, setAccount] = useState("");
    const [userInfo, setUserInfo] = useState(null);
    const [records, setRecords] = useState([]);
    const [logs, setLogs] = useState([]);
    const [message, setMessage] = useState("");

    // Registration
    const [patientName, setPatientName] = useState("");
    const [age, setAge] = useState("");
    const [gender, setGender] = useState("");
    const [hospitals, setHospitals] = useState([]);
    const [selectedHospitalId, setSelectedHospitalId] = useState("");
    const [loadingHospitals, setLoadingHospitals] = useState(false);

    // Notifications
    const [consentRequests, setConsentRequests] = useState([]); // { recordId, requester, requesterName, roleName }
    const [grantedConsents, setGrantedConsents] = useState([]); // { recordId, grantee, granteeName, roleName }
    const [emergencyAccesses, setEmergencyAccesses] = useState([]);
    const [loadingNotifications, setLoadingNotifications] = useState(false);

    // Load hospitals
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

    // Check registration
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
        fetchHospitals();
    }, [fetchHospitals]);

    useEffect(() => {
        checkRegistration();
    }, [checkRegistration]);

    // After registration, load records and set up notification polling
    useEffect(() => {
        if (userInfo && userInfo.role === 1) {
            loadPatientRecords();
            loadNotifications();
            const interval = setInterval(() => {
                loadNotifications();
            }, 10000);
            return () => clearInterval(interval);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userInfo]);

    // Load notifications (consent requests and emergency accesses)
    //
    // FIX: The previous implementation passed recordId hex values as an event
    // filter. Web3 indexed-event filters require 32-byte padded hex strings,
    // but web3.utils.numberToHex() produces un-padded values (e.g. "0x1"),
    // so the filter silently returned no events.
    //
    // Solution: fetch ALL past events for the relevant topics and filter
    // client-side by comparing the numeric recordId against the patient's
    // own record list. This is reliable regardless of hex formatting.
    //
    const loadNotifications = async () => {
        if (!userInfo || userInfo.role !== 1) return;
        setLoadingNotifications(true);
        try {
            const recordIds = await contract.methods.getPatientRecords(account).call();
            const requests = [];
            const emergencies = [];

            if (recordIds.length > 0) {
                // Build a Set of the patient's record IDs (as numbers) for O(1) lookup
                const myRecordIdSet = new Set(recordIds.map(id => Number(id)));

                // Fetch ALL ConsentRequested events – filter client-side
                const consentEvents = await contract.getPastEvents("ConsentRequested", {
                    fromBlock: 0,
                    toBlock: "latest"
                });

                for (const event of consentEvents) {
                    const { recordId, requester } = event.returnValues;
                    const recordIdNum = Number(recordId);

                    // Only care about records that belong to this patient
                    if (!myRecordIdSet.has(recordIdNum)) continue;

                    // Skip if consent was already granted
                    const alreadyGranted = await contract.methods.consentGiven(recordId, requester).call();
                    if (alreadyGranted) continue;

                    // Fetch requester info for display
                    const requesterUser = await contract.methods.users(requester).call();
                    const requesterName = requesterUser.registered ? requesterUser.name : "Unknown";
                    const roleNum = Number(requesterUser.role);
                    const roleName = roleNum === 2 ? "Doctor" : (roleNum === 4 ? "Stakeholder" : "Unknown");

                    requests.push({
                        recordId: recordIdNum,
                        requester,
                        requesterName,
                        roleName
                    });
                }

                // Fetch ALL EmergencyAccessGranted events – filter client-side
                const emergencyEvents = await contract.getPastEvents("EmergencyAccessGranted", {
                    fromBlock: 0,
                    toBlock: "latest"
                });

                for (const event of emergencyEvents) {
                    const { doctor, recordId, expiry } = event.returnValues;
                    const recordIdNum = Number(recordId);

                    // Only care about records that belong to this patient
                    if (!myRecordIdSet.has(recordIdNum)) continue;

                    const expiryNum = Number(expiry);
                    // Only show still-active emergency accesses
                    if (expiryNum <= Math.floor(Date.now() / 1000)) continue;

                    // Verify on-chain that the emergency access is still live
                    const liveExpiry = await contract.methods.emergencyAccess(doctor, recordId).call();
                    if (Number(liveExpiry) <= Math.floor(Date.now() / 1000)) continue;

                    const doctorUser = await contract.methods.users(doctor).call();
                    const doctorName = doctorUser.registered ? doctorUser.name : "Unknown";

                    emergencies.push({
                        recordId: recordIdNum,
                        doctor,
                        doctorName,
                        expiry: expiryNum
                    });
                }
                // ── Tier 2 – currently active granted consents (doctors & stakeholders) ──
                // Fetch ConsentGiven events then verify consent is still active
                // (patient may have revoked it, setting consentGiven back to false).
                const consentGivenEvents = await contract.getPastEvents("ConsentGiven", {
                    fromBlock: 0,
                    toBlock: "latest"
                });
                const granted = [];
                const seen = new Set(); // deduplicate (recordId, grantee)
                for (const event of consentGivenEvents) {
                    const { recordId, grantee } = event.returnValues;
                    const recordIdNum = Number(recordId);
                    if (!myRecordIdSet.has(recordIdNum)) continue;
                    const key = `${recordIdNum}-${grantee}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    // Verify still active on-chain
                    const stillActive = await contract.methods.consentGiven(recordId, grantee).call();
                    if (!stillActive) continue;
                    const granteeUser = await contract.methods.users(grantee).call();
                    const granteeName = granteeUser.registered ? granteeUser.name : "Unknown";
                    const roleNum = Number(granteeUser.role);
                    const roleName = roleNum === 2 ? "Doctor" : (roleNum === 4 ? "Stakeholder" : "Unknown");
                    granted.push({ recordId: recordIdNum, grantee, granteeName, roleName });
                }
                setGrantedConsents(granted);
            }

            setConsentRequests(requests);
            setEmergencyAccesses(emergencies);
        } catch (err) {
            console.error("Error loading notifications:", err);
        } finally {
            setLoadingNotifications(false);
        }
    };

    // Registration
    const ensurePatient = async () => {
        if (userInfo && userInfo.role === 1) return true;
        if (!patientName || !age || !gender || !selectedHospitalId) {
            setMessage("Please fill all fields and select a hospital");
            return false;
        }
        try {
            setMessage("Registering...");
            await contract.methods.registerPatient(patientName, age, gender, selectedHospitalId).send({
                from: account,
                gas: 3000000
            });
            setMessage("✅ Registration successful!");
            await checkRegistration();
            return true;
        } catch (err) {
            setMessage("Registration failed: " + err.message);
            return false;
        }
    };

    // Load records
    const loadPatientRecords = async () => {
        try {
            const recordIds = await contract.methods.getPatientRecords(account).call();
            const recordsData = await Promise.all(recordIds.map(async id => {
                const idNum = Number(id);
                const rec = await contract.methods.records(idNum).call();
                return {
                    id: idNum,
                    hospitalId: Number(rec.hospitalId),
                    ipfsHash: rec.ipfsHash,
                    timestamp: Number(rec.timestamp)
                };
            }));
            setRecords(recordsData);
        } catch (err) {
            setMessage("Error loading records: " + err.message);
        }
    };

    // Human-readable tier labels for access log display
    const tierLabel = (tier) => {
        switch (tier) {
            case 1: return "Tier 1 – Same Hospital";
            case 2: return "Tier 2 – Explicit Consent";
            case 3: return "Tier 3 – Emergency";
            case 5: return "Tier 5 – Consent Revoked";
            default: return `Tier ${tier}`;
        }
    };

    // View access logs with names
    const viewLogs = async (recordId) => {
        try {
            const logs = await contract.methods.getAccessLogs(recordId).call();
            const enhanced = await Promise.all(logs.map(async log => {
                const accessor = log.accessor;
                const user = await contract.methods.users(accessor).call();
                const accessorName = user.registered ? user.name : "Unknown";
                let hospitalName = "";
                if (user.registered && (Number(user.role) === 2 || Number(user.role) === 3)) {
                    const hospital = await contract.methods.hospitals(user.hospitalId).call();
                    hospitalName = hospital.name;
                } else if (user.registered && Number(user.role) === 4) {
                    hospitalName = "Stakeholder";
                }
                return {
                    accessor,
                    tier: Number(log.tier),
                    time: Number(log.time),
                    accessorName,
                    hospitalName
                };
            }));
            setLogs(enhanced);
        } catch (err) {
            setMessage("Error fetching logs: " + err.message);
        }
    };

    // Download record
    const downloadRecord = async (recordId, ipfsHash) => {
        try {
            let encryptedResp;
            try {
                encryptedResp = await axios.get(`http://localhost:8080/ipfs/${ipfsHash}`, {
                    responseType: "arraybuffer",
                    timeout: 5000
                });
            } catch (localErr) {
                console.warn("Local gateway failed, trying public gateway", localErr);
                encryptedResp = await axios.get(`https://ipfs.io/ipfs/${ipfsHash}`, {
                    responseType: "arraybuffer"
                });
            }
            const encryptedData = new Uint8Array(encryptedResp.data);

            const keyResp = await axios.get(`http://localhost:5001/get-key/${recordId}/${account}`);
            if (!keyResp.data.success) {
                setMessage("Key retrieval failed: not authorized");
                return;
            }
            const keyHex = keyResp.data.key;
            const key = hexToBytes(keyHex);

            const iv = encryptedData.slice(0, 16);
            const ciphertext = encryptedData.slice(16);

            const cryptoKey = await window.crypto.subtle.importKey(
                "raw",
                key,
                { name: "AES-CBC" },
                false,
                ["decrypt"]
            );

            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-CBC", iv: iv },
                cryptoKey,
                ciphertext
            );

            const blob = new Blob([decrypted]);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `record_${recordId}.bin`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            setMessage("✅ File downloaded successfully.");
        } catch (err) {
            console.error("Download error details:", err);
            setMessage("Error downloading record: " + err.message);
        }
    };

    // Give consent (Tier 2 – explicit consent for doctors & stakeholders)
    const giveConsent = async (recordId, grantee) => {
        try {
            await contract.methods.giveConsent(recordId, grantee).send({ from: account });
            setMessage(`✅ Consent given to ${grantee}`);
            setConsentRequests(prev => prev.filter(req => !(req.recordId === recordId && req.requester === grantee)));
        } catch (err) {
            setMessage("Error giving consent: " + err.message);
        }
    };

    // Revoke granted consent (Tier 2)
    const revokeConsent = async (recordId, grantee) => {
        try {
            await contract.methods.revokeConsent(recordId, grantee).send({ from: account });
            setMessage(`✅ Consent revoked for ${grantee}`);
            setGrantedConsents(prev => prev.filter(g => !(g.recordId === recordId && g.grantee === grantee)));
        } catch (err) {
            setMessage("Error revoking consent: " + err.message);
        }
    };

    // Revoke emergency access (Tier 3)
    const revokeEmergency = async (recordId, doctor) => {
        try {
            await contract.methods.revokeEmergencyAccess(recordId, doctor).send({ from: account });
            setMessage(`✅ Emergency access revoked for ${doctor}`);
            setEmergencyAccesses(prev => prev.filter(em => !(em.recordId === recordId && em.doctor === doctor)));
        } catch (err) {
            setMessage("Error revoking: " + err.message);
        }
    };

    // If not registered
    if (!userInfo) {
        return (
            <Container className="mt-4">
                <h2 className="hero-title">Patient Registration</h2>
                <p className="hero-subtitle">Connected as: {account}</p>
                {message && <Alert variant="info" dismissible onClose={() => setMessage("")}>{message}</Alert>}
                <Card className="card-custom">
                    <Card.Body>
                        <Form>
                            <Form.Group>
                                <Form.Label>Full Name</Form.Label>
                                <Form.Control value={patientName} onChange={e => setPatientName(e.target.value)} />
                            </Form.Group>
                            <Form.Group>
                                <Form.Label>Age</Form.Label>
                                <Form.Control type="number" value={age} onChange={e => setAge(e.target.value)} />
                            </Form.Group>
                            <Form.Group>
                                <Form.Label>Gender</Form.Label>
                                <Form.Select value={gender} onChange={e => setGender(e.target.value)}>
                                    <option value="">Select</option>
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                    <option value="Other">Other</option>
                                </Form.Select>
                            </Form.Group>
                            <Form.Group>
                                <Form.Label>Primary Hospital</Form.Label>
                                {loadingHospitals ? <Spinner size="sm" /> : (
                                    <Form.Select value={selectedHospitalId} onChange={e => setSelectedHospitalId(e.target.value)}>
                                        <option value="">Select</option>
                                        {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                                    </Form.Select>
                                )}
                            </Form.Group>
                            <Button className="mt-3 btn-medical" onClick={ensurePatient}>Register</Button>
                        </Form>
                    </Card.Body>
                </Card>
            </Container>
        );
    }

    // If registered but not patient
    if (userInfo.role !== 1) {
        return <Alert variant="warning">This account is not a patient.</Alert>;
    }

    // Main dashboard
    return (
        <Container className="mt-4">
            <h2 className="hero-title">Patient Dashboard</h2>
            <p className="hero-subtitle">
                Connected as: {account}<br />
                <strong>Name:</strong> {userInfo.name}
            </p>
            {message && <Alert variant="info" dismissible onClose={() => setMessage("")}>{message}</Alert>}

            <Tabs defaultActiveKey="records" className="mb-3">
                <Tab eventKey="records" title="My Records">
                    <Button onClick={loadPatientRecords} className="mb-3 btn-medical">Load My Records</Button>
                    {records.length > 0 ? (
                        <Table striped bordered hover>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Hospital</th>
                                    <th>Timestamp</th>
                                    <th>IPFS Hash</th>
                                    <th>Logs</th>
                                    <th>Download</th>
                                </tr>
                            </thead>
                            <tbody>
                                {records.map(rec => (
                                    <tr key={rec.id}>
                                        <td>{rec.id}</td>
                                        <td>{rec.hospitalId}</td>
                                        <td>{new Date(rec.timestamp * 1000).toLocaleString()}</td>
                                        <td>{rec.ipfsHash.substring(0, 10)}...</td>
                                        <td>
                                            <Button size="sm" className="btn-medical" onClick={() => viewLogs(rec.id)}>View Logs</Button>
                                        </td>
                                        <td>
                                            <Button size="sm" variant="success" className="btn-medical" onClick={() => downloadRecord(rec.id, rec.ipfsHash)}>
                                                Download
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    ) : (
                        <p>No records found. Click "Load My Records".</p>
                    )}

                    {logs.length > 0 && (
                        <>
                            <h4 className="mt-3">Access Logs</h4>
                            <Table size="sm" striped bordered>
                                <thead>
                                    <tr>
                                        <th>Accessor Address</th>
                                        <th>Name</th>
                                        <th>Hospital / Type</th>
                                        <th>Tier</th>
                                        <th>Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log, idx) => (
                                        <tr key={idx}>
                                            <td>{log.accessor}</td>
                                            <td>{log.accessorName}</td>
                                            <td>{log.hospitalName}</td>
                                            <td>{tierLabel(log.tier)}</td>
                                            <td>{new Date(log.time * 1000).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </>
                    )}
                </Tab>

                <Tab eventKey="consent" title="Manage Access">
                    {/* Refresh button */}
                    <div className="d-flex justify-content-between align-items-center mb-3">
                        <h5>Notifications</h5>
                        <Button
                            size="sm"
                            variant="outline-info"
                            onClick={loadNotifications}
                            disabled={loadingNotifications}
                        >
                            {loadingNotifications ? <Spinner size="sm" /> : "Refresh"}
                        </Button>
                    </div>

                    {/* Consent Requests (Tier 2 – doctors & stakeholders) */}
                    {consentRequests.length > 0 && (
                        <Card className="card-custom mb-3">
                            <Card.Body>
                                <Card.Title>Pending Consent Requests</Card.Title>
                                <Table striped bordered hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>Record ID</th>
                                            <th>Requester</th>
                                            <th>Name</th>
                                            <th>Role</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {consentRequests.map((req, idx) => (
                                            <tr key={idx}>
                                                <td>{req.recordId}</td>
                                                <td>{req.requester}</td>
                                                <td>{req.requesterName}</td>
                                                <td>{req.roleName}</td>
                                                <td>
                                                    <Button
                                                        size="sm"
                                                        variant="success"
                                                        className="btn-medical"
                                                        onClick={() => giveConsent(req.recordId, req.requester)}
                                                    >
                                                        Grant Consent
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </Card.Body>
                        </Card>
                    )}

                    {/* Granted Consents (Tier 2 – doctors & stakeholders) – with Revoke */}
                    {grantedConsents.length > 0 && (
                        <Card className="card-custom mb-3">
                            <Card.Body>
                                <Card.Title>Active Granted Consents</Card.Title>
                                <Table striped bordered hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>Record ID</th>
                                            <th>Grantee</th>
                                            <th>Name</th>
                                            <th>Role</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {grantedConsents.map((g, idx) => (
                                            <tr key={idx}>
                                                <td>{g.recordId}</td>
                                                <td>{g.grantee}</td>
                                                <td>{g.granteeName}</td>
                                                <td>{g.roleName}</td>
                                                <td>
                                                    <Button
                                                        size="sm"
                                                        variant="danger"
                                                        className="btn-medical"
                                                        onClick={() => revokeConsent(g.recordId, g.grantee)}
                                                    >
                                                        Revoke Consent
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </Card.Body>
                        </Card>
                    )}

                    {/* Emergency Accesses (Tier 3) */}
                    {emergencyAccesses.length > 0 && (
                        <Card className="card-custom mb-3">
                            <Card.Body>
                                <Card.Title>Active Emergency Accesses</Card.Title>
                                <Table striped bordered hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>Record ID</th>
                                            <th>Doctor</th>
                                            <th>Name</th>
                                            <th>Expires</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {emergencyAccesses.map((em, idx) => (
                                            <tr key={idx}>
                                                <td>{em.recordId}</td>
                                                <td>{em.doctor}</td>
                                                <td>{em.doctorName}</td>
                                                <td>{new Date(em.expiry * 1000).toLocaleString()}</td>
                                                <td>
                                                    <Button
                                                        size="sm"
                                                        variant="danger"
                                                        className="btn-medical"
                                                        onClick={() => revokeEmergency(em.recordId, em.doctor)}
                                                    >
                                                        Revoke Access
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </Card.Body>
                        </Card>
                    )}

                    {consentRequests.length === 0 && emergencyAccesses.length === 0 && grantedConsents.length === 0 && (
                        <p>No pending notifications.</p>
                    )}
                </Tab>
            </Tabs>
        </Container>
    );
}

export default Patient;