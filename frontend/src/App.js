import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Patient from "./pages/Patient";
import Doctor from "./pages/Doctor";
import Hospital from "./pages/Hospital";
import Stakeholder from "./pages/Stakeholder";
import 'bootstrap/dist/css/bootstrap.min.css';
import "./styles/theme.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/patient" element={<Patient />} />
        <Route path="/doctor" element={<Doctor />} />
        <Route path="/hospital" element={<Hospital />} />
        <Route path="/stakeholder" element={<Stakeholder />} />
      </Routes>
    </Router>
  );
}

export default App;