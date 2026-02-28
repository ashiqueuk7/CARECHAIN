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
    const [consentRequests, setConsentRequests] = useState([]);
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
            // Poll for new notifications every 10 seconds
            const interval = setInterval(() => {
                loadNotifications();
            }, 10000);
            return () => clearInterval(interval);
        }
    }, [userInfo]);

    // Load notifications (consent requests and emergency accesses)
    const loadNotifications = async () => {
        if (!userInfo || userInfo.role !== 1) return;
        setLoadingNotifications(true);
        try {
            const recordIds = await contract.methods.getPatientRecords(account).call();
            const requests = [];
            const emergencies = [];

            if (recordIds.length > 0) {
                const recordHexIds = recordIds.map(id => web3.utils.numberToHex(id));

                // Fetch ConsentRequested events
                const consentEvents = await contract.getPastEvents("ConsentRequested", {
                    filter: { recordId: recordHexIds },
                    fromBlock: 0,
                    toBlock: "latest"
                });
                for (const event of consentEvents) {
                    const { recordId, doctor } = event.returnValues;
                    // Check if consent not already given
                    const consentGiven = await contract.methods.consentGiven(recordId, doctor).call();
                    if (!consentGiven) {
                        requests.push({ recordId: Number(recordId), doctor });
                    }
                }

                // Fetch EmergencyAccessGranted events
                const emergencyEvents = await contract.getPastEvents("EmergencyAccessGranted", {
                    filter: { recordId: recordHexIds },
                    fromBlock: 0,
                    toBlock: "latest"
                });
                for (const event of emergencyEvents) {
                    const { doctor, recordId, expiry } = event.returnValues;
                    const expiryNum = Number(expiry);
                    // Only show if still active
                    if (expiryNum > Math.floor(Date.now() / 1000)) {
                        emergencies.push({
                            recordId: Number(recordId),
                            doctor,
                            expiry: expiryNum
                        });
                    }
                }
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

    // View access logs with doctor names
    const viewLogs = async (recordId) => {
        try {
            const logs = await contract.methods.getAccessLogs(recordId).call();
            const enhanced = await Promise.all(logs.map(async log => {
                const doctor = log.accessor;
                const user = await contract.methods.users(doctor).call();
                const doctorName = user.registered ? user.name : "Unknown";
                let hospitalName = "";
                if (user.registered && (Number(user.role) === 2 || Number(user.role) === 3)) {
                    const hospital = await contract.methods.hospitals(user.hospitalId).call();
                    hospitalName = hospital.name;
                }
                return {
                    accessor: doctor,
                    tier: Number(log.tier),
                    time: Number(log.time),
                    doctorName,
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

    // Give consent (Tier 2)
    const giveConsent = async (recordId, doctor) => {
        try {
            await contract.methods.giveConsent(recordId, doctor).send({ from: account });
            setMessage(`✅ Consent given to ${doctor} for record ${recordId}`);
            setConsentRequests(prev => prev.filter(req => !(req.recordId === recordId && req.doctor === doctor)));
        } catch (err) {
            setMessage("Error giving consent: " + err.message);
        }
    };

    // Revoke emergency access (Tier 3)
    const revokeEmergency = async (recordId, doctor) => {
        try {
            await contract.methods.revokeEmergencyAccess(recordId, doctor).send({ from: account });
            setMessage(`✅ Emergency access revoked for ${doctor} on record ${recordId}`);
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
                                        <th>Doctor Address</th>
                                        <th>Doctor Name</th>
                                        <th>Hospital</th>
                                        <th>Tier</th>
                                        <th>Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log, idx) => (
                                        <tr key={idx}>
                                            <td>{log.accessor}</td>
                                            <td>{log.doctorName}</td>
                                            <td>{log.hospitalName}</td>
                                            <td>{log.tier}</td>
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

                    {/* Consent Requests (Tier 2) */}
                    {consentRequests.length > 0 && (
                        <Card className="card-custom mb-3">
                            <Card.Body>
                                <Card.Title>Pending Consent Requests (Tier 2)</Card.Title>
                                <Table striped bordered hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>Record ID</th>
                                            <th>Requester Address</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {consentRequests.map((req, idx) => (
                                            <tr key={idx}>
                                                <td>{req.recordId}</td>
                                                <td>{req.doctor}</td>
                                                <td>
                                                    <Button
                                                        size="sm"
                                                        variant="success"
                                                        className="btn-medical"
                                                        onClick={() => giveConsent(req.recordId, req.doctor)}
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

                    {/* Emergency Accesses (Tier 3) */}
                    {emergencyAccesses.length > 0 && (
                        <Card className="card-custom mb-3">
                            <Card.Body>
                                <Card.Title>Active Emergency Accesses (Tier 3)</Card.Title>
                                <Table striped bordered hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>Record ID</th>
                                            <th>Doctor Address</th>
                                            <th>Expires</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {emergencyAccesses.map((em, idx) => (
                                            <tr key={idx}>
                                                <td>{em.recordId}</td>
                                                <td>{em.doctor}</td>
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

                    {consentRequests.length === 0 && emergencyAccesses.length === 0 && (
                        <p>No pending notifications.</p>
                    )}
                </Tab>
            </Tabs>
        </Container>
    );
}

export default Patient;