// contract.js
import web3 from "./web3";
import CareChain from "../abis/CareChain.json";

// Replace with your deployed contract address
const contractAddress = "0x54672a239f4a1488C4668eF59d242c0fcFF965e9";

const contract = new web3.eth.Contract(CareChain.abi, contractAddress);

export default contract;