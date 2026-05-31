import React, { useState, useEffect, useCallback } from "react";
import { Container, Form, Button, Table, Alert, Card, Spinner, Tabs, Tab } from "react-bootstrap";
import web3 from "../utils/web3";
import contract from "../utils/contract";
import axios from "axios";
import "../styles/theme.css";

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

function Doctor() {
    const [account, setAccount] = useState("");
    const [userInfo, setUserInfo] = useState(null);
    const [hospitalName, setHospitalName] = useState("");
    const [message, setMessage] = useState("");

    // Registration form
    const [doctorName, setDoctorName] = useState("");
    const [specialty, setSpecialty] = useState("");
    const [selectedHospitalId, setSelectedHospitalId] = useState("");
    const [hospitals, setHospitals] = useState([]);
    const [loadingHospitals, setLoadingHospitals] = useState(false);

    // Patients at own hospital (with names)
    const [ownPatientsWithNames, setOwnPatientsWithNames] = useState([]);
    const [selectedOwnPatient, setSelectedOwnPatient] = useState(null);
    const [ownPatientRecords, setOwnPatientRecords] = useState([]);
    const [loadingOwnPatients, setLoadingOwnPatients] = useState(false);
    const [loadingOwnRecords, setLoadingOwnRecords] = useState(false);
    const [selectedPatientDetails, setSelectedPatientDetails] = useState(null);

    // Other hospitals
    const [otherHospitals, setOtherHospitals] = useState([]);
    const [selectedOtherHospital, setSelectedOtherHospital] = useState("");
    const [otherPatientsWithNames, setOtherPatientsWithNames] = useState([]);
    const [selectedOtherPatient, setSelectedOtherPatient] = useState(null);
    const [otherPatientRecords, setOtherPatientRecords] = useState([]);
    const [loadingOtherPatients, setLoadingOtherPatients] = useState(false);
    const [loadingOtherRecords, setLoadingOtherRecords] = useState(false);

    // requestedEmergency: in-flight loading indicator (cleared after tx)
    const [requestedEmergency, setRequestedEmergency] = useState(new Set());
    // pendingConsentRecords: persistent – records where this doctor already sent
    // a consent request but the patient hasn't responded yet
    const [pendingConsentRecords, setPendingConsentRecords] = useState(new Set());
    // grantedConsentRecords: persistent – records where consent was already given
    const [grantedConsentRecords, setGrantedConsentRecords] = useState(new Set());
    // consentTxInFlight: temporary loading indicator while tx is being sent
    const [consentTxInFlight, setConsentTxInFlight] = useState(new Set());

    // Fetch hospitals list
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
                if (Number(user.hospitalId) > 0) {
                    const hospital = await contract.methods.hospitals(user.hospitalId).call();
                    setHospitalName(hospital.name);
                }
            } else {
                setUserInfo(null);
                setHospitalName("");
            }
        } catch (err) {
            console.warn("Error checking registration:", err);
            setUserInfo(null);
            setHospitalName("");
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

    // Fetch own hospital patients and their names
    useEffect(() => {
        if (!userInfo || userInfo.role !== 2) return;
        const fetchOwnPatients = async () => {
            setLoadingOwnPatients(true);
            try {
                const patientList = await contract.methods.getHospitalPatients(userInfo.hospitalId).call();
                const withNames = await Promise.all(patientList.map(async addr => {
                    const user = await contract.methods.users(addr).call();
                    return { addr, name: user.name };
                }));
                setOwnPatientsWithNames(withNames);
            } catch (err) {
                console.error("Error fetching own hospital patients:", err);
            } finally {
                setLoadingOwnPatients(false);
            }
        };
        fetchOwnPatients();
    }, [userInfo]);

    // Filter other hospitals
    useEffect(() => {
        if (userInfo && hospitals.length > 0) {
            setOtherHospitals(hospitals.filter(h => h.id !== userInfo.hospitalId));
        } else {
            setOtherHospitals(hospitals);
        }
    }, [hospitals, userInfo]);

    // Handle own patient selection
    const handleOwnPatientSelect = async (patientAddr) => {
        setSelectedOwnPatient(patientAddr);
        setSelectedPatientDetails(null);
        setLoadingOwnRecords(true);
        try {
            const patientUser = await contract.methods.users(patientAddr).call();
            setSelectedPatientDetails({
                name: patientUser.name,
                age: Number(patientUser.age),
                gender: patientUser.gender
            });

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
            setOwnPatientRecords(records);
        } catch (err) {
            setMessage("Error loading patient data: " + err.message);
        } finally {
            setLoadingOwnRecords(false);
        }
    };

    // Download record (with access logging)
    const downloadRecord = async (recordId, ipfsHash) => {
        try {
            await contract.methods.accessRecord(recordId).send({ from: account, gas: 300000 });

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

    // Handle other hospital selection
    const handleOtherHospitalSelect = async (hospitalId) => {
        setSelectedOtherHospital(hospitalId);
        setSelectedOtherPatient(null);
        setOtherPatientRecords([]);
        setLoadingOtherPatients(true);
        try {
            const patientList = await contract.methods.getHospitalPatients(hospitalId).call();
            const withNames = await Promise.all(patientList.map(async addr => {
                const user = await contract.methods.users(addr).call();
                return { addr, name: user.name };
            }));
            setOtherPatientsWithNames(withNames);
        } catch (err) {
            console.error("Error fetching other hospital patients:", err);
        } finally {
            setLoadingOtherPatients(false);
        }
    };

    // Request consent – uses separate in-flight vs persistent state so the
    // button stays disabled with "Pending" even after the tx completes.
    const requestConsent = async (recordId) => {
        setConsentTxInFlight(prev => new Set(prev).add(recordId));
        try {
            // Client-side pre-checks (saves gas on obvious failures)
            const record = await contract.methods.records(recordId).call();
            if (!record || Number(record.id) === 0) {
                setMessage("❌ Record does not exist.");
                return;
            }
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
            const emergencyExpiry = await contract.methods.emergencyAccess(account, recordId).call();
            if (Number(emergencyExpiry) > Math.floor(Date.now() / 1000)) {
                setMessage("❌ Emergency access is still active. It will expire automatically.");
                return;
            }

            await contract.methods.requestConsent(recordId).send({ from: account, gas: 300000 });

            // Mark as pending persistently so the button stays "Pending" even
            // after the page re-renders without needing another blockchain read.
            setPendingConsentRecords(prev => new Set(prev).add(recordId));
            setMessage("✅ Consent request sent! The patient will see a notification in their dashboard.");
        } catch (err) {
            console.error("Full error object:", err);
            let reason = "Unknown error";
            if (err.data && err.data.message) {
                reason = err.data.message;
            } else if (err.message) {
                const match = err.message.match(/revert\s+(.*?)(\s+at|$)/i);
                reason = match ? match[1] : err.message;
            }
            if (reason.includes("Consent already given")) {
                setGrantedConsentRecords(prev => new Set(prev).add(recordId));
                setMessage("ℹ️ Consent already granted for this record.");
            } else if (reason.includes("Emergency access already active")) {
                setMessage("❌ Emergency access is still active for this record.");
            } else {
                setMessage("❌ Error requesting consent: " + reason);
            }
        } finally {
            setConsentTxInFlight(prev => {
                const next = new Set(prev);
                next.delete(recordId);
                return next;
            });
        }
    };

    // Emergency access with button disabling
    const requestEmergencyAccess = async (recordId) => {
        setRequestedEmergency(prev => new Set(prev).add(recordId));
        try {
            await contract.methods.requestEmergencyAccess(recordId).send({ from: account, gas: 300000 });
            setMessage("✅ Emergency access granted for 24 hours. You can now download the record.");
        } catch (err) {
            console.error("Emergency access error:", err);
            setMessage("Error: " + err.message);
        } finally {
            setRequestedEmergency(prev => {
                const newSet = new Set(prev);
                newSet.delete(recordId);
                return newSet;
            });
        }
    };

    // Fetch records for selected other patient + check consent status for each
    const handleOtherPatientSelect = async (patientAddr) => {
        setSelectedOtherPatient(patientAddr);
        setLoadingOtherRecords(true);
        // Clear stale consent state whenever a new patient is selected
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
            setOtherPatientRecords(records);

            // For each record, check on-chain whether this doctor has already
            // requested consent or been granted consent, so buttons show the
            // correct persistent state immediately on load.
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
            setLoadingOtherRecords(false);
        }
    };

    // Registration
    const registerDoctor = async () => {
        if (!doctorName || !selectedHospitalId) {
            setMessage("Please enter name and select hospital");
            return;
        }
        try {
            setMessage("Registering...");
            await contract.methods.registerDoctor(doctorName, selectedHospitalId).send({
                from: account,
                gas: 3000000
            });
            setMessage("✅ Doctor registered successfully!");
            setDoctorName("");
            setSpecialty("");
            setSelectedHospitalId("");
            await checkRegistration();
        } catch (err) {
            setMessage("Registration failed: " + err.message);
        }
    };

    // Render registration form if not registered
    if (!userInfo) {
        return (
            <Container className="mt-4">
                <div className="card-custom">
                    <h2>Doctor Registration</h2>
                    <p>Connected as: {account}</p>
                    {message && <Alert variant="info">{message}</Alert>}
                    <Card className="border-0 bg-transparent">
                        <Card.Body>
                            <Form>
                                <Form.Group className="mb-3">
                                    <Form.Label>Full Name</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={doctorName}
                                        onChange={e => setDoctorName(e.target.value)}
                                        placeholder="Dr. John Doe"
                                    />
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label>Specialty (optional)</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={specialty}
                                        onChange={e => setSpecialty(e.target.value)}
                                        placeholder="Cardiology"
                                    />
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label>Select Hospital</Form.Label>
                                    {loadingHospitals ? (
                                        <Spinner size="sm" />
                                    ) : (
                                        <Form.Select
                                            value={selectedHospitalId}
                                            onChange={e => setSelectedHospitalId(e.target.value)}
                                        >
                                            <option value="">-- Select Hospital --</option>
                                            {hospitals.map(h => (
                                                <option key={h.id} value={h.id}>{h.name}</option>
                                            ))}
                                        </Form.Select>
                                    )}
                                </Form.Group>
                                <Button className="btn-medical" onClick={registerDoctor}>
                                    Register
                                </Button>
                            </Form>
                        </Card.Body>
                    </Card>
                </div>
            </Container>
        );
    }

    if (userInfo.role !== 2) {
        return (
            <Container className="mt-4">
                <div className="card-custom">
                    <Alert variant="warning">This account is not a doctor. Please use a doctor account.</Alert>
                </div>
            </Container>
        );
    }

    // Main dashboard
    return (
        <Container className="mt-4">
            <div className="card-custom mb-4">
                <h2>Doctor Dashboard</h2>
                <p><strong>Dr. {userInfo.name}</strong> | {hospitalName}</p>
                <p>Connected as: {account}</p>
                {message && <Alert variant="info" dismissible onClose={() => setMessage("")}>{message}</Alert>}
            </div>

            <Tabs defaultActiveKey="own" className="mb-3" fill>
                <Tab eventKey="own" title="My Hospital Patients">
                    <div className="card-custom">
                        <Card className="border-0 bg-transparent">
                            <Card.Body>
                                <Card.Title>Patients at your hospital</Card.Title>
                                {loadingOwnPatients ? (
                                    <Spinner animation="border" size="sm" />
                                ) : ownPatientsWithNames.length > 0 ? (
                                    <Table striped bordered hover size="sm">
                                        <thead>
                                            <tr><th>Patient</th><th>Action</th></tr>
                                        </thead>
                                        <tbody>
                                            {ownPatientsWithNames.map(p => (
                                                <tr key={p.addr}>
                                                    <td>
                                                        {p.addr}<br/>
                                                        <small className="text-muted">{p.name}</small>
                                                    </td>
                                                    <td>
                                                        <Button
                                                            size="sm"
                                                            variant={selectedOwnPatient === p.addr ? "success" : "primary"}
                                                            onClick={() => handleOwnPatientSelect(p.addr)}
                                                        >
                                                            {selectedOwnPatient === p.addr ? "Selected" : "View Records"}
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                ) : (
                                    <p>No patients registered at your hospital.</p>
                                )}

                                {selectedOwnPatient && (
                                    <>
                                        {selectedPatientDetails && (
                                            <div className="mb-3 p-3 border rounded bg-light">
                                                <h5>Patient Details</h5>
                                                <p><strong>Name:</strong> {selectedPatientDetails.name}</p>
                                                <p><strong>Age:</strong> {selectedPatientDetails.age}</p>
                                                <p><strong>Gender:</strong> {selectedPatientDetails.gender}</p>
                                            </div>
                                        )}
                                        <h5 className="mt-3">Records for {selectedOwnPatient}</h5>
                                        {loadingOwnRecords ? (
                                            <Spinner size="sm" />
                                        ) : ownPatientRecords.length > 0 ? (
                                            <Table size="sm" striped bordered>
                                                <thead>
                                                    <tr>
                                                        <th>ID</th>
                                                        <th>Hospital</th>
                                                        <th>Timestamp</th>
                                                        <th>IPFS Hash</th>
                                                        <th>Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {ownPatientRecords.map(rec => (
                                                        <tr key={rec.id}>
                                                            <td>{rec.id}</td>
                                                            <td>{rec.hospitalId}</td>
                                                            <td>{new Date(rec.timestamp * 1000).toLocaleString()}</td>
                                                            <td>{rec.ipfsHash.substring(0, 10)}...</td>
                                                            <td>
                                                                <Button size="sm" className="btn-medical" onClick={() => downloadRecord(rec.id, rec.ipfsHash)}>
                                                                    Download
                                                                </Button>
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
                    </div>
                </Tab>

                <Tab eventKey="other" title="Other Hospitals">
                    <div className="card-custom">
                        <Card className="border-0 bg-transparent">
                            <Card.Body>
                                <Card.Title>Select a hospital</Card.Title>
                                <Form.Group>
                                    <Form.Select
                                        value={selectedOtherHospital}
                                        onChange={e => handleOtherHospitalSelect(e.target.value)}
                                    >
                                        <option value="">-- Choose Hospital --</option>
                                        {otherHospitals.map(h => (
                                            <option key={h.id} value={h.id}>{h.name}</option>
                                        ))}
                                    </Form.Select>
                                </Form.Group>

                                {selectedOtherHospital && (
                                    <>
                                        <h5 className="mt-3">Patients at this hospital</h5>
                                        {loadingOtherPatients ? (
                                            <Spinner size="sm" />
                                        ) : otherPatientsWithNames.length > 0 ? (
                                            <Table striped bordered hover size="sm">
                                                <thead>
                                                    <tr><th>Patient</th><th>Action</th></tr>
                                                </thead>
                                                <tbody>
                                                    {otherPatientsWithNames.map(p => (
                                                        <tr key={p.addr}>
                                                            <td>
                                                                {p.addr}<br/>
                                                                <small className="text-muted">{p.name}</small>
                                                            </td>
                                                            <td>
                                                                <Button
                                                                    size="sm"
                                                                    variant="info"
                                                                    onClick={() => handleOtherPatientSelect(p.addr)}
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

                                        {selectedOtherPatient && (
                                            <>
                                                <h5 className="mt-3">Records for {selectedOtherPatient}</h5>
                                                {loadingOtherRecords ? (
                                                    <Spinner size="sm" />
                                                ) : otherPatientRecords.length > 0 ? (
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
                                                            {otherPatientRecords.map(rec => (
                                                                <tr key={rec.id}>
                                                                    <td>{rec.id}</td>
                                                                    <td>{rec.hospitalId}</td>
                                                                    <td>{new Date(rec.timestamp * 1000).toLocaleString()}</td>
                                                                    <td>
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
                                                                            onClick={() => requestConsent(rec.id)}
                                                                        >
                                                                            {consentTxInFlight.has(rec.id) ? "Sending…" :
                                                                             grantedConsentRecords.has(rec.id) ? "✓ Granted" :
                                                                             pendingConsentRecords.has(rec.id) ? "⏳ Pending" :
                                                                             "Request Consent"}
                                                                        </Button>
                                                                        <Button
                                                                            size="sm"
                                                                            variant="danger"
                                                                            className="me-1"
                                                                            disabled={requestedEmergency.has(rec.id)}
                                                                            onClick={() => requestEmergencyAccess(rec.id)}
                                                                        >
                                                                            {requestedEmergency.has(rec.id) ? "Requested" : "Emergency Access"}
                                                                        </Button>
                                                                        <Button
                                                                            size="sm"
                                                                            variant="success"
                                                                            onClick={() => downloadRecord(rec.id, rec.ipfsHash)}
                                                                        >
                                                                            Download
                                                                        </Button>
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
                                    </>
                                )}
                            </Card.Body>
                        </Card>
                    </div>
                </Tab>
            </Tabs>
        </Container>
    );
}

export default Doctor;