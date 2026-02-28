import React, { useState, useEffect, useCallback } from "react";
import { Container, Form, Button, Alert, Card, Table, Spinner } from "react-bootstrap";
import contract from "../utils/contract";
import axios from "axios";
import "../styles/theme.css"; // Apply custom light theme

// Helper: convert hex string to Uint8Array (browser-compatible)
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

function Hospital() {
    const [account, setAccount] = useState("");
    const [userInfo, setUserInfo] = useState(null);
    const [hospitalName, setHospitalName] = useState("");
    const [selectedPatient, setSelectedPatient] = useState("");
    const [file, setFile] = useState(null);
    const [message, setMessage] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [newHospitalName, setNewHospitalName] = useState("");
    const [loading, setLoading] = useState(false);
    const [patients, setPatients] = useState([]);
    const [loadingPatients, setLoadingPatients] = useState(false);
    
    // New state for patient records
    const [patientRecords, setPatientRecords] = useState([]);
    const [loadingRecords, setLoadingRecords] = useState(false);

    // Get current MetaMask account
    useEffect(() => {
        const loadAccount = async () => {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                setAccount(accounts[0]);
            }
        };
        loadAccount();
        if (window.ethereum) {
            window.ethereum.on("accountsChanged", (accounts) => {
                setAccount(accounts.length > 0 ? accounts[0] : "");
            });
        }
    }, []);

    // Check registration status
    const checkRegistration = useCallback(async (address) => {
        if (!address) {
            setUserInfo(null);
            return;
        }
        setLoading(true);
        try {
            const user = await contract.methods.users(address).call();
            if (user.registered) {
                const role = Number(user.role);
                const hospitalId = Number(user.hospitalId);
                setUserInfo({ ...user, role, hospitalId });
                if (role === 3) {
                    const hospital = await contract.methods.hospitals(hospitalId).call();
                    setHospitalName(hospital.name);
                }
            } else {
                setUserInfo(null);
            }
        } catch (err) {
            console.error("Error checking registration:", err);
            setMessage("Error checking registration. Please ensure contract is deployed and address/ABI are correct.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        checkRegistration(account);
    }, [account, checkRegistration]);

    // Fetch patients for this hospital (using the new mapping)
    useEffect(() => {
        if (!userInfo || userInfo.role !== 3) {
            setPatients([]);
            return;
        }
        const fetchPatientsForHospital = async () => {
            setLoadingPatients(true);
            try {
                const hospitalId = userInfo.hospitalId;
                const patientList = await contract.methods.getHospitalPatients(hospitalId).call();
                setPatients(patientList);
            } catch (err) {
                console.error("Error fetching patients:", err);
                setMessage("Error loading patients for this hospital.");
            } finally {
                setLoadingPatients(false);
            }
        };
        fetchPatientsForHospital();
    }, [userInfo]);

    // Fetch records of selected patient
    useEffect(() => {
        if (!selectedPatient || !userInfo || userInfo.role !== 3) {
            setPatientRecords([]);
            return;
        }
        const fetchPatientRecords = async () => {
            setLoadingRecords(true);
            try {
                const recordIds = await contract.methods.getPatientRecords(selectedPatient).call();
                const recordsData = await Promise.all(recordIds.map(async (id) => {
                    const idNum = Number(id);
                    const rec = await contract.methods.records(idNum).call();
                    return {
                        id: idNum,
                        hospitalId: Number(rec.hospitalId),
                        ipfsHash: rec.ipfsHash,
                        timestamp: Number(rec.timestamp)
                    };
                }));
                setPatientRecords(recordsData);
            } catch (err) {
                console.error("Error fetching patient records:", err);
                setMessage("Error loading patient records.");
            } finally {
                setLoadingRecords(false);
            }
        };
        fetchPatientRecords();
    }, [selectedPatient, userInfo]);

    // Register a new hospital
    const registerHospital = async () => {
        if (!newHospitalName) {
            setMessage("Please enter hospital name");
            return;
        }
        try {
            setMessage(`Registering hospital "${newHospitalName}"...`);
            await contract.methods.registerHospital(newHospitalName).send({
                from: account,
                gas: 3000000
            });
            setMessage("✅ Hospital registered successfully!");
            setNewHospitalName("");
            checkRegistration(account);
        } catch (err) {
            console.error("Registration error:", err);
            setMessage("Registration failed: " + err.message);
        }
    };

    const uploadFile = async () => {
        if (!file || !selectedPatient) {
            setMessage("Please select a patient and choose a file");
            return;
        }
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const uploadRes = await axios.post("http://localhost:5001/upload", formData, {
                headers: { "Content-Type": "multipart/form-data" }
            });
            if (!uploadRes.data.success) {
                setMessage("Upload failed");
                setIsUploading(false);
                return;
            }
            const ipfsHash = uploadRes.data.ipfsHash;

            const receipt = await contract.methods.uploadRecord(selectedPatient, ipfsHash).send({
                from: account,
                gas: 3000000
            });
            const event = receipt.events.RecordUploaded;
            const recordId = event.returnValues.recordId.toString();

            await axios.post("http://localhost:5001/associate-key", { ipfsHash, recordId });

            setMessage(`✅ Record uploaded successfully. Record ID: ${recordId}`);
            setPatients(prev => prev.includes(selectedPatient) ? prev : [...prev, selectedPatient]);
            // Refresh records list after upload
            const recordIds = await contract.methods.getPatientRecords(selectedPatient).call();
            const recordsData = await Promise.all(recordIds.map(async (id) => {
                const idNum = Number(id);
                const rec = await contract.methods.records(idNum).call();
                return {
                    id: idNum,
                    hospitalId: Number(rec.hospitalId),
                    ipfsHash: rec.ipfsHash,
                    timestamp: Number(rec.timestamp)
                };
            }));
            setPatientRecords(recordsData);
        } catch (err) {
            console.error("Upload error:", err);
            setMessage("Error: " + err.message);
        } finally {
            setIsUploading(false);
        }
    };

    // Download a record
    const downloadRecord = async (recordId, ipfsHash) => {
        try {
            // Fetch encrypted data from IPFS (includes IV at beginning)
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

            // Get decryption key from backend
            const keyResp = await axios.get(`http://localhost:5001/get-key/${recordId}/${account}`);
            if (!keyResp.data.success) {
                setMessage("Key retrieval failed: not authorized");
                return;
            }
            const keyHex = keyResp.data.key;
            // Replace Buffer with hexToBytes
            const key = hexToBytes(keyHex);

            // Extract IV (first 16 bytes) and ciphertext
            const iv = encryptedData.slice(0, 16);
            const ciphertext = encryptedData.slice(16);

            // Decrypt using Web Crypto API
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

            // Create a Blob and trigger download
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

    const renderContent = () => {
        if (!account) {
            return <Alert variant="warning">Please connect MetaMask.</Alert>;
        }
        if (loading) {
            return <Spinner animation="border" />;
        }
        if (!userInfo) {
            return (
                <Card className="card-custom mt-4">
                    <Card.Body>
                        <Card.Title>Register as Hospital</Card.Title>
                        <Form>
                            <Form.Group>
                                <Form.Label>Hospital Name</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={newHospitalName}
                                    onChange={(e) => setNewHospitalName(e.target.value)}
                                    placeholder="e.g., City General Hospital"
                                />
                            </Form.Group>
                            <Button className="mt-2 btn-medical" onClick={registerHospital}>
                                Register
                            </Button>
                        </Form>
                    </Card.Body>
                </Card>
            );
        }
        if (userInfo.role !== 3) {
            const roleNames = ["None", "Patient", "Doctor", "HospitalAdmin"];
            return (
                <Alert variant="warning">
                    This account is registered as <strong>{roleNames[userInfo.role]}</strong>. 
                    Please switch to a hospital admin account.
                </Alert>
            );
        }
        return (
            <>
                <Card className="card-custom mb-4">
                    <Card.Body>
                        <Card.Title>Hospital: {hospitalName} (ID: {userInfo.hospitalId})</Card.Title>
                        <p>Patients registered with this hospital:</p>
                        {loadingPatients ? (
                            <Spinner animation="border" size="sm" />
                        ) : patients.length > 0 ? (
                            <Table striped bordered hover size="sm">
                                <thead>
                                    <tr>
                                        <th>Patient Address</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {patients.map((addr, idx) => (
                                        <tr key={idx}>
                                            <td>{addr}</td>
                                            <td>
                                                <Button 
                                                    variant={selectedPatient === addr ? "success" : "primary"}
                                                    size="sm"
                                                    onClick={() => setSelectedPatient(addr)}
                                                >
                                                    {selectedPatient === addr ? "Selected" : "Select"}
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        ) : (
                            <p>No patients found for this hospital. Patients need to register with this hospital first.</p>
                        )}
                    </Card.Body>
                </Card>

                <Card className="card-custom">
                    <Card.Body>
                        <Card.Title>Upload Medical Record</Card.Title>
                        <Form>
                            <Form.Group>
                                <Form.Label>Selected Patient</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={selectedPatient || "No patient selected"}
                                    readOnly
                                    plaintext
                                />
                            </Form.Group>
                            <Form.Group>
                                <Form.Label>Medical Record File</Form.Label>
                                <Form.Control
                                    type="file"
                                    onChange={(e) => setFile(e.target.files[0])}
                                />
                            </Form.Group>
                            <Button
                                className="mt-3 btn-medical"
                                onClick={uploadFile}
                                disabled={isUploading || !selectedPatient}
                            >
                                {isUploading ? "Uploading..." : "Upload Record"}
                            </Button>
                        </Form>
                    </Card.Body>
                </Card>

                {selectedPatient && (
                    <Card className="card-custom mt-3">
                        <Card.Body>
                            <Card.Title>Existing Records for {selectedPatient}</Card.Title>
                            {loadingRecords ? (
                                <Spinner animation="border" size="sm" />
                            ) : patientRecords.length > 0 ? (
                                <Table striped bordered hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Hospital ID</th>
                                            <th>Timestamp</th>
                                            <th>IPFS Hash</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patientRecords.map(rec => (
                                            <tr key={rec.id}>
                                                <td>{rec.id}</td>
                                                <td>{rec.hospitalId}</td>
                                                <td>{new Date(rec.timestamp * 1000).toLocaleString()}</td>
                                                <td>{rec.ipfsHash.substring(0, 10)}...</td>
                                                <td>
                                                    <Button
                                                        size="sm"
                                                        variant="success"
                                                        className="btn-medical"
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
                                <p>No records found for this patient.</p>
                            )}
                        </Card.Body>
                    </Card>
                )}
            </>
        );
    };

    return (
        <Container className="mt-4">
            <h2 className="hero-title">Hospital Admin Dashboard</h2>
            <p className="hero-subtitle">Connected as: {account || "Not connected"}</p>
            {message && <Alert variant="info" dismissible onClose={() => setMessage("")}>{message}</Alert>}
            {renderContent()}
        </Container>
    );
}

export default Hospital;