// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CareChain {
    enum Role { None, Patient, Doctor, HospitalAdmin }

    struct User {
        string name;
        uint age;          // new
        string gender;     // new
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
        uint tier;         // 1=same hospital, 2=consent, 3=emergency
        uint time;
    }

    uint public hospitalCounter;
    uint public recordCounter;

    mapping(address => User) public users;
    mapping(uint => Hospital) public hospitals;
    mapping(uint => Record) public records;
    mapping(address => uint[]) public patientRecords;
    mapping(uint => address[]) public hospitalPatients;      // primary patients of hospital
    mapping(uint => AccessLog[]) public accessLogs;

    // Tier 2: explicit consent (given by patient)
    mapping(uint => mapping(address => bool)) public consentGiven;

    // Tier 3: emergency access (time-limited)
    mapping(address => mapping(uint => uint)) public emergencyAccess;

    // Consent requests (doctor → patient)
    mapping(uint => mapping(address => bool)) public consentRequested;

    // Events
    event PatientRegistered(address indexed patient, string name, uint hospitalId);
    event HospitalRegistered(uint indexed hospitalId, string name, address admin);
    event DoctorRegistered(address indexed doctor, string name, uint hospitalId);
    event RecordUploaded(uint indexed recordId, address indexed patient, uint hospitalId, string ipfsHash);
    event ConsentRequested(uint indexed recordId, address indexed doctor);
    event ConsentGiven(uint indexed recordId, address indexed doctor);
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

        // Ensure patient appears in hospital's patient list
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

    // ================= CONSENT REQUESTS (TIER 2) =================

    function requestConsent(uint _recordId) public {
        require(users[msg.sender].role == Role.Doctor, "Only doctors can request consent");
        Record memory r = records[_recordId];
        require(r.id != 0, "Record does not exist");
        require(!consentGiven[_recordId][msg.sender], "Consent already given");
        require(emergencyAccess[msg.sender][_recordId] == 0, "Emergency access already active");

        consentRequested[_recordId][msg.sender] = true;
        emit ConsentRequested(_recordId, msg.sender);
    }

    function giveConsent(uint _recordId, address _doctor) public {
        require(records[_recordId].patient == msg.sender, "Only patient can give consent");
        require(users[_doctor].role == Role.Doctor, "Consent can only be given to a doctor");

        consentGiven[_recordId][_doctor] = true;
        delete consentRequested[_recordId][_doctor];

        accessLogs[_recordId].push(AccessLog(_doctor, _recordId, 2, block.timestamp));
        emit ConsentGiven(_recordId, _doctor);
        emit AccessLogged(_doctor, _recordId, 2, block.timestamp);
    }

    // ================= EMERGENCY ACCESS (TIER 3) =================

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

    // ================= ACCESS CONTROL FOR RETRIEVING RECORD =================

    function getRecord(uint _recordId) public view returns (string memory ipfsHash, uint hospitalId, uint timestamp) {
        Record memory r = records[_recordId];
        require(r.id != 0, "Record does not exist");

        bool authorized = false;

        if (msg.sender == r.patient) {
            authorized = true;
        }
        else if (users[msg.sender].role == Role.Doctor || users[msg.sender].role == Role.HospitalAdmin) {
            if (users[msg.sender].hospitalId == r.hospitalId) {
                authorized = true;
            }
        }
        else if (consentGiven[_recordId][msg.sender]) {
            authorized = true;
        }
        else if (emergencyAccess[msg.sender][_recordId] > block.timestamp) {
            authorized = true;
        }

        require(authorized, "Not authorized to access this record");
        return (r.ipfsHash, r.hospitalId, r.timestamp);
    }

    // ================= VIEW FUNCTIONS =================

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