// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Allowance} from "../src/Allowance.sol";

/// forge script script/Deploy.s.sol --rpc-url <RPC> --private-key <KEY> --broadcast
contract Deploy is Script {
    function run() external returns (Allowance al) {
        vm.startBroadcast();
        al = new Allowance();
        vm.stopBroadcast();
        console.log("Allowance deployed at", address(al));
    }
}
