import { Link } from "react-router-dom";

function Navbar() {
  return (
    <nav className="navbar navbar-dark bg-dark px-4">
      <h4 className="text-info">CareChain</h4>
      <div>
        <Link to="/" className="btn btn-outline-info m-1">Home</Link>
        <Link to="/patient" className="btn btn-outline-info m-1">Patient</Link>
        <Link to="/doctor" className="btn btn-outline-info m-1">Doctor</Link>
        <Link to="/hospital" className="btn btn-outline-info m-1">Hospital</Link>
        <Link to="/stakeholder" className="btn btn-outline-info m-1">Stakeholder</Link>
      </div>
    </nav>
  );
}

export default Navbar;