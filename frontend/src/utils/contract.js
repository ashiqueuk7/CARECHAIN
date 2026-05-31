// contract.js
import web3 from "./web3";
import CareChain from "../abis/CareChain.json";

// Replace with your deployed contract address
const contractAddress = "0x70332dc0812F00EAb2Bb91c8434aeF4a80e78C25";

const contract = new web3.eth.Contract(CareChain.abi, contractAddress);

export default contract;