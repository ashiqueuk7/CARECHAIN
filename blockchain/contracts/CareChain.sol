// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CareChain {
    enum Role { None, Patient, Doctor, HospitalAdmin, Stakeholder }

    struct User {
        string name;
        uint age;
        string gender;
        Role role;
        uint hospitalId;
        bool registered;
    }

    struct Hospital {
        uint id;
        string name;
        address admin;
    }

    struct Record {
        uint id;
        address patient;
        uint hospitalId;
        string ipfsHash;
        uint timestamp;
    }

    struct AccessLog {
        address accessor;
        uint recordId;
        uint tier;
        uint time;
    }

    uint public hospitalCounter;
    uint public recordCounter;

    mapping(address => User) public users;
    mapping(uint => Hospital) public hospitals;
    mapping(uint => Record) public records;
    mapping(address => uint[]) public patientRecords;
    mapping(uint => address[]) public hospitalPatients;
    mapping(uint => AccessLog[]) public accessLogs;

    mapping(uint => mapping(address => bool)) public consentGiven;
    mapping(address => mapping(uint => uint)) public emergencyAccess;
    mapping(uint => mapping(address => bool)) public consentRequested;

    event PatientRegistered(address indexed patient, string name, uint hospitalId);
    event HospitalRegistered(uint indexed hospitalId, string name, address admin);
    event DoctorRegistered(address indexed doctor, string name, uint hospitalId);
    event StakeholderRegistered(address indexed stakeholder, string name);
    event RecordUploaded(uint indexed recordId, address indexed patient, uint hospitalId, string ipfsHash);
    event ConsentRequested(uint indexed recordId, address indexed requester);
    event ConsentGiven(uint indexed recordId, address indexed grantee);
    event ConsentRevoked(uint indexed recordId, address indexed grantee);
    event EmergencyAccessGranted(address indexed doctor, uint indexed recordId, uint expiry);
    event AccessLogged(address indexed accessor, uint indexed recordId, uint tier, uint time);

    // ================= REGISTRATION =================

    function registerPatient(string memory _name, uint _age, string memory _gender, uint _hospitalId) public {
        require(!users[msg.sender].registered, "Already registered");
        require(_hospitalId > 0 && _hospitalId <= hospitalCounter, "Invalid hospital ID");
        users[msg.sender] = User(_name, _age, _gender, Role.Patient, _hospitalId, true);
        hospitalPatients[_hospitalId].push(msg.sender);
        emit PatientRegistered(msg.sender, _name, _hospitalId);
    }

    function registerHospital(string memory _name) public {
        require(!users[msg.sender].registered, "Already registered");
        hospitalCounter++;
        hospitals[hospitalCounter] = Hospital(hospitalCounter, _name, msg.sender);
        users[msg.sender] = User(_name, 0, "", Role.HospitalAdmin, hospitalCounter, true);
        emit HospitalRegistered(hospitalCounter, _name, msg.sender);
    }

    function registerDoctor(string memory _name, uint _hospitalId) public {
        require(!users[msg.sender].registered, "Already registered");
        require(_hospitalId > 0 && _hospitalId <= hospitalCounter, "Invalid hospital ID");
        users[msg.sender] = User(_name, 0, "", Role.Doctor, _hospitalId, true);
        emit DoctorRegistered(msg.sender, _name, _hospitalId);
    }

    function registerStakeholder(string memory _name) public {
        require(!users[msg.sender].registered, "Already registered");
        users[msg.sender] = User(_name, 0, "", Role.Stakeholder, 0, true);
        emit StakeholderRegistered(msg.sender, _name);
    }

    // ================= HOSPITAL UPLOAD =================

    function uploadRecord(address _patient, string memory _ipfsHash) public {
        require(users[msg.sender].role == Role.HospitalAdmin, "Only hospital admin");
        require(_patient != address(0), "Invalid patient address");
        uint hospitalId = users[msg.sender].hospitalId;

        recordCounter++;
        records[recordCounter] = Record(
            recordCounter,
            _patient,
            hospitalId,
            _ipfsHash,
            block.timestamp
        );
        patientRecords[_patient].push(recordCounter);
        emit RecordUploaded(recordCounter, _patient, hospitalId, _ipfsHash);

        bool alreadyInHospital = false;
        for (uint i = 0; i < hospitalPatients[hospitalId].length; i++) {
            if (hospitalPatients[hospitalId][i] == _patient) {
                alreadyInHospital = true;
                break;
            }
        }
        if (!alreadyInHospital) {
            hospitalPatients[hospitalId].push(_patient);
        }
    }

    // ================= ACCESS RECORD =================
    //
    // BUG FIX: The original used an else-if chain that caused cross-hospital
    // doctors to be caught by the "role == Doctor" branch and then fail the
    // same-hospital sub-check, making the emergency-access branch unreachable.
    // Fix: evaluate each tier independently so all paths are always checked.
    //
    function accessRecord(uint _recordId) public returns (string memory ipfsHash, uint hospitalId, uint timestamp) {
        Record memory r = records[_recordId];
        require(r.id != 0, "Record does not exist");

        uint tier;
        bool authorized = false;

        // Patient owns the record – no logging needed
        if (msg.sender == r.patient) {
            return (r.ipfsHash, r.hospitalId, r.timestamp);
        }

        // Tier 1 – same-hospital doctor or admin (evaluated independently)
        if (!authorized &&
            (users[msg.sender].role == Role.Doctor || users[msg.sender].role == Role.HospitalAdmin) &&
            users[msg.sender].hospitalId == r.hospitalId)
        {
            authorized = true;
            tier = 1;
        }

        // Tier 2 – explicit consent (any cross-institutional party: doctor or stakeholder)
        if (!authorized && consentGiven[_recordId][msg.sender]) {
            authorized = true;
            tier = 2;
        }

        // Tier 3 – active emergency access (doctors only)
        // This is now reachable even for cross-hospital doctors because the
        // Tier 1 check above only sets authorized=true on a match.
        if (!authorized && emergencyAccess[msg.sender][_recordId] > block.timestamp) {
            authorized = true;
            tier = 3;
        }

        require(authorized, "Not authorized to access this record");

        accessLogs[_recordId].push(AccessLog(msg.sender, _recordId, tier, block.timestamp));
        emit AccessLogged(msg.sender, _recordId, tier, block.timestamp);

        return (r.ipfsHash, r.hospitalId, r.timestamp);
    }

    // ================= CONSENT =================

    function requestConsent(uint _recordId) public {
        require(
            users[msg.sender].role == Role.Doctor || users[msg.sender].role == Role.Stakeholder,
            "Only doctors or stakeholders can request consent"
        );
        Record memory r = records[_recordId];
        require(r.id != 0, "Record does not exist");
        require(!consentGiven[_recordId][msg.sender], "Consent already given");
        // FIX: use <= block.timestamp instead of == 0. After emergency access
        // expires the slot holds a past timestamp (never 0 again), which would
        // permanently block a subsequent consent request with the old check.
        require(emergencyAccess[msg.sender][_recordId] <= block.timestamp, "Emergency access already active");

        consentRequested[_recordId][msg.sender] = true;
        emit ConsentRequested(_recordId, msg.sender);
    }

    function giveConsent(uint _recordId, address _grantee) public {
        require(records[_recordId].patient == msg.sender, "Only patient can give consent");
        require(users[_grantee].registered, "Grantee must be registered");

        consentGiven[_recordId][_grantee] = true;
        delete consentRequested[_recordId][_grantee];

        // Both doctors and stakeholders access via explicit consent = Tier 2
        require(
            users[_grantee].role == Role.Doctor || users[_grantee].role == Role.Stakeholder,
            "Consent can only be given to doctors or stakeholders"
        );
        uint tier = 2;

        accessLogs[_recordId].push(AccessLog(_grantee, _recordId, tier, block.timestamp));
        emit ConsentGiven(_recordId, _grantee);
        emit AccessLogged(_grantee, _recordId, tier, block.timestamp);
    }

    // ================= EMERGENCY ACCESS (Tier 3) =================

    function requestEmergencyAccess(uint _recordId) public {
        require(users[msg.sender].role == Role.Doctor, "Only doctors can request emergency access");
        Record memory r = records[_recordId];
        require(r.id != 0, "Record does not exist");

        uint expiry = block.timestamp + 24 hours;
        emergencyAccess[msg.sender][_recordId] = expiry;

        accessLogs[_recordId].push(AccessLog(msg.sender, _recordId, 3, block.timestamp));
        emit EmergencyAccessGranted(msg.sender, _recordId, expiry);
        emit AccessLogged(msg.sender, _recordId, 3, block.timestamp);
    }

    function revokeEmergencyAccess(uint _recordId, address _doctor) public {
        require(records[_recordId].patient == msg.sender, "Only patient can revoke");
        require(emergencyAccess[_doctor][_recordId] > 0, "No active emergency access");
        delete emergencyAccess[_doctor][_recordId];
    }

    // Tier 2: Patient revokes previously granted consent (doctors or stakeholders).
    // consentGiven is set back to false so the grantee can no longer call
    // accessRecord. A tier-5 log entry records the revocation for audit.
    function revokeConsent(uint _recordId, address _grantee) public {
        require(records[_recordId].patient == msg.sender, "Only patient can revoke consent");
        require(consentGiven[_recordId][_grantee], "No active consent to revoke");

        consentGiven[_recordId][_grantee] = false;

        // tier 5 = consent revoked by patient
        accessLogs[_recordId].push(AccessLog(msg.sender, _recordId, 5, block.timestamp));
        emit ConsentRevoked(_recordId, _grantee);
        emit AccessLogged(msg.sender, _recordId, 5, block.timestamp);
    }

    // ================= VIEW (no state change / no log) =================

    function getRecord(uint _recordId) public view returns (string memory ipfsHash, uint hospitalId, uint timestamp) {
        Record memory r = records[_recordId];
        require(r.id != 0, "Record does not exist");

        bool authorized = (msg.sender == r.patient);

        if (!authorized &&
            (users[msg.sender].role == Role.Doctor || users[msg.sender].role == Role.HospitalAdmin) &&
            users[msg.sender].hospitalId == r.hospitalId)
        {
            authorized = true;
        }

        if (!authorized && consentGiven[_recordId][msg.sender]) {
            authorized = true;
        }

        if (!authorized && emergencyAccess[msg.sender][_recordId] > block.timestamp) {
            authorized = true;
        }

        require(authorized, "Not authorized to access this record");
        return (r.ipfsHash, r.hospitalId, r.timestamp);
    }

    // ================= GETTERS =================

    function getPatientRecords(address _patient) public view returns (uint[] memory) {
        return patientRecords[_patient];
    }

    function getAccessLogs(uint _recordId) public view returns (AccessLog[] memory) {
        return accessLogs[_recordId];
    }

    function getHospitalPatients(uint _hospitalId) public view returns (address[] memory) {
        return hospitalPatients[_hospitalId];
    }
}
