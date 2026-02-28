import React from "react";
import { Link } from "react-router-dom";
import { Container, Row, Col } from "react-bootstrap";

function Home() {
    return (
        <Container className="mt-5 pt-5">
            {/* Hero Section */}
            <div className="text-center mb-5">
                <h1 className="hero-title">CareChain</h1>
                <p className="hero-subtitle">
                    Blockchain‑based medical record exchange<br />
                    <small style={{ opacity: 0.7 }}>Powered by Ethereum & IPFS</small>
                </p>
            </div>

            {/* Role Cards - Equal height using flex */}
            <Row className="g-4 row-equal">
                <Col md={6} lg={3}>
                    <div className="card-custom role-card">
                        <h3>🧑 Patient</h3>
                        <p>Own your health data, control access, and manage consents.</p>
                        <Link to="/patient" className="btn-medical">Enter</Link>
                    </div>
                </Col>
                <Col md={6} lg={3}>
                    <div className="card-custom role-card">
                        <h3>👨‍⚕️ Doctor</h3>
                        <p>Securely access patient records with tiered authorization.</p>
                        <Link to="/doctor" className="btn-medical">Enter</Link>
                    </div>
                </Col>
                <Col md={6} lg={3}>
                    <div className="card-custom role-card">
                        <h3>🏥 Hospital</h3>
                        <p>Upload encrypted records and manage hospital patients.</p>
                        <Link to="/hospital" className="btn-medical">Enter</Link>
                    </div>
                </Col>
                <Col md={6} lg={3}>
                    <div className="card-custom role-card">
                        <h3>📊 Stakeholder</h3>
                        <p>Request anonymised data for research and insights.</p>
                        <Link to="/stakeholder" className="btn-medical">Enter</Link>
                    </div>
                </Col>
            </Row>

            {/* Footer / Trust indicators */}
            <footer className="mt-5 text-center text-muted">
                <p style={{ fontSize: '0.9rem' }}>
                    🔒 End‑to‑end encryption • Decentralized storage • Granular consent
                </p>
            </footer>
        </Container>
    );
}

export default Home;