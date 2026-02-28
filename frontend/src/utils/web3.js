import Web3 from "web3";

let web3;

if (window.ethereum) {
    web3 = new Web3(window.ethereum);
    // Optional: request accounts
    window.ethereum.request({ method: "eth_requestAccounts" }).catch(console.error);
} else {
    alert("Please install MetaMask");
}

export default web3;