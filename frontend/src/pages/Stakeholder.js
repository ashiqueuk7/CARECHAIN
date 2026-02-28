import React, { useState, useEffect, useCallback } from "react";
import { Container, Card, Form, Button, Alert, Spinner, Table } from "react-bootstrap";
import { Link } from "react-router-dom";
import web3 from "../utils/web3";
import contract from "../utils/contract";
import "../styles/theme.css";

function Stakeholder() {
    const [account, setAccount] = useState("");
    const [userInfo, setUserInfo] = useState(null);
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    // Registration
    const [orgName, setOrgName] = useState("");
    const [orgType, setOrgType] = useState(""); // "Insurance" or "Research"
    const [registering, setRegistering] = useState(false);

    // Hospitals and patients
    const [hospitals, setHospitals] = useState([]);
    const [selectedHospital, setSelectedHospital] = useState("");
    const [patients, setPatients] = useState([]);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [patientRecords, setPatientRecords] = useState([]);
    const [loadingHospitals, setLoadingHospitals] = useState(false);
    const [loadingPatients, setLoadingPatients] = useState(false);
    const [loadingRecords, setLoadingRecords] = useState(false);

    // Load account and check registration
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

    // Check registration status
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

    // If registered as stakeholder, fetch hospitals
    useEffect(() => {
        if (userInfo && userInfo.role === 4) {
            fetchHospitals();
        }
    }, [userInfo, fetchHospitals]);

    // Register stakeholder
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

    // Handle hospital selection
    const handleHospitalSelect = async (hospitalId) => {
        setSelectedHospital(hospitalId);
        setSelectedPatient(null);
        setPatientRecords([]);
        setLoadingPatients(true);
        try {
            const patientList = await contract.methods.getHospitalPatients(hospitalId).call();
            setPatients(patientList);
        } catch (err) {
            console.error("Error fetching patients:", err);
        } finally {
            setLoadingPatients(false);
        }
    };

    // Handle patient selection
    const handlePatientSelect = async (patientAddr) => {
        setSelectedPatient(patientAddr);
        setLoadingRecords(true);
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
        } catch (err) {
            setMessage("Error loading records: " + err.message);
        } finally {
            setLoadingRecords(false);
        }
    };

    // Request access to a record
    const requestAccess = async (recordId) => {
        try {
            await contract.methods.requestConsent(recordId).send({ from: account, gas: 300000 });
            setMessage("✅ Access request sent to patient.");
        } catch (err) {
            console.error("Request error:", err);
            let reason = err.message;
            if (err.data && err.data.message) reason = err.data.message;
            setMessage("❌ Request failed: " + reason);
        }
    };

    // Render registration form if not registered
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

    // If registered but not stakeholder
    if (userInfo.role !== 4) {
        return (
            <Container className="mt-4">
                <Alert variant="warning">This account is not a stakeholder. Please use a stakeholder account.</Alert>
                <Link to="/" className="btn btn-link mt-3" style={{ color: 'cyan' }}>← Back to Home</Link>
            </Container>
        );
    }

    // Main dashboard
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
                            ) : patients.length > 0 ? (
                                <Table striped bordered hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>Patient Address</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patients.map(addr => (
                                            <tr key={addr}>
                                                <td>{addr}</td>
                                                <td>
                                                    <Button
                                                        size="sm"
                                                        variant="info"
                                                        onClick={() => handlePatientSelect(addr)}
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
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patientRecords.map(rec => (
                                            <tr key={rec.id}>
                                                <td>{rec.id}</td>
                                                <td>{rec.hospitalId}</td>
                                                <td>{new Date(rec.timestamp * 1000).toLocaleString()}</td>
                                                <td>
                                                    <Button
                                                        size="sm"
                                                        variant="warning"
                                                        onClick={() => requestAccess(rec.id)}
                                                    >
                                                        Request Access
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

            <Link to="/" className="btn btn-link mt-3" style={{ color: 'cyan' }}>← Back to Home</Link>
        </Container>
    );
}

export default Stakeholder;