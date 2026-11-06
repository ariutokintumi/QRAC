// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Test-only contracts. Not part of QRAC.

/// Standard ERC-20 subset: transfer/approve return true.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// Token whose transfer returns false instead of reverting.
contract FalseToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

/// Token whose transfer returns nothing (USDT-style).
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}

/// Records calls; can be told to revert.
contract Target {
    uint256 public counter;
    address public lastCaller;

    function bump() external payable {
        counter += 1;
        lastCaller = msg.sender;
    }

    function fail() external pure {
        revert("Target: fail");
    }

    function bomb() external pure {
        assembly {
            revert(0, 100000) // huge revert data
        }
    }
}

/// Tries to re-enter the calling account during execution.
contract Reenterer {
    function attack(bytes calldata submitCalldata) external {
        (bool ok, bytes memory ret) = msg.sender.call(submitCalldata);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// Minimal ERC-721 that performs the safeTransfer receiver check.
contract MockNFT {
    mapping(uint256 => address) public ownerOf;

    function mint(address to, uint256 id) external {
        ownerOf[id] = to;
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        require(ownerOf[id] == from && msg.sender == from, "not owner");
        ownerOf[id] = to;
        if (to.code.length > 0) {
            bytes4 r = IERC721Receiver(to).onERC721Received(msg.sender, from, id, "");
            require(r == IERC721Receiver.onERC721Received.selector, "receiver");
        }
    }
}

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}
