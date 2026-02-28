async function main() {
  const CareChain = await ethers.getContractFactory("CareChain");
  const carechain = await CareChain.deploy();
  await carechain.deployed();

  console.log("CareChain deployed to:", carechain.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});