const assert = require('assert');
const { expect } = require('chai');
const { ethers } = require("hardhat");
const fetch = require('cross-fetch');
const ERC20ABI = require("./ERC20.json");
const IJoeRouterABI = require("./router.json");

let escrow, IJoeRouter;

function etherToWei(_ether) {
    return ethers.utils.parseEther(_ether);
}
  
function weiToEther(_wei) {
    return ethers.utils.formatEther(_wei);
}

async function getGas(_response) {
    let gasPrice = _response.gasPrice;
    _response = await _response.wait();
    return _response.gasUsed.mul(gasPrice);
}

async function createOrderAVAXtoSTABLE(amountOutDecimal, buyer, seller) {
    const tokenOut = await escrow.STABLECOIN();
    const tokenOut_DECIMALS = 6;
    let amountOut = amountOutDecimal*10**tokenOut_DECIMALS;
    let path = [
        "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
        tokenOut
        ]
    msg_value = await IJoeRouter.getAmountsIn(amountOut, path);
    msg_value = msg_value[0];
    tx = await escrow
            .connect(buyer)
            .createOrderWithAVAXToStable(seller.address, amountOut, {value: msg_value});
    return [tx,msg_value];
}

describe("SCEscrow Contract", () => {

    let 
        tx, response, gasSpent, msg_value, orders, STABLECOIN,
        owner, seller1, seller2, seller3, buyer1, buyer2, buyer3,
        registeredSellers = 2;

    // Contract Enum
    const created = 0;
    const shipped = 1;
	const confirmed = 2;
	const deleted = 3;
	const refundAsked = 4;
	const refunded = 5;

    const USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
    const JOE_ADDRESS = "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd";
    const QI_ADDRESS = "0x8729438eb15e2c8b576fcc6aecda6a148776c0f5";
    // big whale addresses :)
    const buyer1addr = "0x279f8940ca2a44C35ca3eDf7d28945254d0F0aE6";
    const buyer2addr = "0x4aeFa39caEAdD662aE31ab0CE7c8C2c9c0a013E8";
    const joeAPI = "https://api.traderjoexyz.com/priceusd/";
    const slippageTolerance = 3;
    
    beforeEach(async () => {
        let SCEscrow = await ethers.getContractFactory('SCEscrow');
        escrow = await SCEscrow.deploy();
        [owner, buyer3, seller1, seller2, seller3, _] = await ethers.getSigners();
        IJoeRouter = new ethers.Contract("0x60aE616a2155Ee3d9A68541Ba4544862310933d4", IJoeRouterABI, owner);

        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [
                buyer1addr
            ],
        });
        buyer1 = await ethers.getSigner(buyer1addr);
        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [
                buyer2addr
            ],
        });
        buyer2 = await ethers.getSigner(buyer2addr);
        
        await escrow.connect(seller1).registerAsSeller();    
        await escrow.connect(seller2).registerAsSeller();    
        await createOrderAVAXtoSTABLE(1999, buyer1, seller1);
        await createOrderAVAXtoSTABLE(179, buyer2, seller1);
        await createOrderAVAXtoSTABLE(66, buyer2, seller1);
        orders = await escrow.getOrders();
        const stablecoin_address = await escrow.STABLECOIN();
        STABLECOIN = new ethers.Contract(stablecoin_address, ERC20ABI, buyer1);
    });

    describe('Deployment', () => {
        it("UT01 - Sets the right owner", async () => {
            expect(await escrow.owner()).to.equal(owner.address);
        })
    });
    
    describe('Seller registration', () => {
        it("UT02 - Registers a seller", async () => {
            let sellers = await escrow.getSellers();
            expect(sellers[0]).to.equal(seller1.address);
        })
        it("UT03 - Doesn't allow a seller to register more than one time", async () => {
            expect(escrow.connect(seller1).registerAsSeller()).to.be.reverted;
        })
    });

    describe("Creates orders successfully", () => {
        it("UT04 - createOrderWithAVAXToStable() works", async function () {
            const amount = 1999;

            const tokenOut_DECIMALS = 6;
            const tokenOut = await escrow.STABLECOIN();
            let TOKENOUT = new ethers.Contract(tokenOut, ERC20ABI, buyer1);

            let buyer1_AVAX_balance_BEFORE = await buyer1.getBalance();
            let escrow_USD_balance_BEFORE = await TOKENOUT.balanceOf(escrow.address);
            escrow_USD_balance_BEFORE = escrow_USD_balance_BEFORE/10**tokenOut_DECIMALS;

            response = await createOrderAVAXtoSTABLE(amount, buyer1, seller1)
            gasSpent = await getGas(response[0]);
            msg_value_sent = response[1];

            let buyer1_AVAX_balance_AFTER = await buyer1.getBalance();
            let escrow_USD_balance_AFTER = await TOKENOUT.balanceOf(escrow.address);
            escrow_USD_balance_AFTER = escrow_USD_balance_AFTER/10**tokenOut_DECIMALS;
            
            expect(escrow_USD_balance_AFTER-escrow_USD_balance_BEFORE).to.equal(amount); // tokens have been received by smart contract
            expect(buyer1_AVAX_balance_AFTER).to.equal(buyer1_AVAX_balance_BEFORE.sub(msg_value_sent).sub(gasSpent)); // buyer spent exactly amountOut
        });
        it("UT05 - createOrderWithStable() works", async function () {
            const tokenOut = await escrow.STABLECOIN();
            const tokenIn = tokenOut;
            const amountOut_ROUNDED = 1999;
            const tokenOut_DECIMALS = 6;
            
            let TOKENIN = new ethers.Contract(tokenIn, ERC20ABI, buyer1);
            let amountOut = amountOut_ROUNDED*10**tokenOut_DECIMALS;

            let buyer1_USD_balance_BEFORE = await TOKENIN.balanceOf(buyer1.address);
            buyer1_USD_balance_BEFORE = buyer1_USD_balance_BEFORE/10**tokenOut_DECIMALS;
            let escrow_USD_balance_BEFORE = await TOKENIN.balanceOf(escrow.address);
            escrow_USD_balance_BEFORE = escrow_USD_balance_BEFORE/10**tokenOut_DECIMALS;
 
            tx = await TOKENIN.approve(escrow.address, amountOut);
            tx = await escrow
                    .connect(buyer1)
                    .createOrderWithStable(seller1.address, amountOut);

            msg_value = 1;
            let revertedTx = escrow.connect(buyer1).createOrderWithStable(seller1.address, amountOut, {value: msg_value});
            expect(revertedTx).to.be.reverted;
            revertedTx = escrow.connect(buyer1).createOrderWithStable(seller1.address, 0);
            expect(revertedTx).to.be.reverted;

            let buyer1_USD_balance_AFTER = await TOKENIN.balanceOf(buyer1.address);
            buyer1_USD_balance_AFTER = buyer1_USD_balance_AFTER/10**tokenOut_DECIMALS;
            let escrow_USD_balance_AFTER = await TOKENIN.balanceOf(escrow.address);
            escrow_USD_balance_AFTER = escrow_USD_balance_AFTER/10**tokenOut_DECIMALS;

            expect(escrow_USD_balance_AFTER-escrow_USD_balance_BEFORE).to.equal(amountOut_ROUNDED); // tokens have been received by smart contract
            expect(buyer1_USD_balance_AFTER).to.equal(buyer1_USD_balance_BEFORE - amountOut_ROUNDED); // buyer spent exactly amountOut
        });
        it("UT06 - createOrderWithTokensToStable() works", async function () {
            const tokenIn = JOE_ADDRESS;
            const tokenOut = await escrow.STABLECOIN();
            const tokenOut_DECIMALS = 6;
            const amountOut_AMOUNT = 1399;
            let response = await fetch(joeAPI+tokenIn);
            let data = await response.json();

            let priceTOKENIN_real = data/10**18;
            
            let TOKENIN = new ethers.Contract(tokenIn, ERC20ABI, buyer1);
            let TOKENOUT = new ethers.Contract(tokenOut, ERC20ABI, buyer1);
            let amountOut = amountOut_AMOUNT*10**tokenOut_DECIMALS;
            let path = [
                tokenIn,
                "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
                tokenOut
            ]
            let amountInMax = await IJoeRouter.getAmountsIn(amountOut, path);
            amountInMaxExpected = amountInMax[0];
            // HERE WE ARE SENDING THE DOUBLE OF THE EXPECTED AMOUNT_IN TO DEMONSTRATE
            // TRADERJOE SENDS BACK EXCEEDING TOKENS TO THE SMART CONTRACT, WHICH
            // SENDS BACK TO THE USER WHO IS CREATING THE ORDER
            amountInMax = amountInMaxExpected.mul(2);

            let buyer1_TOKEN_balance_BEFORE = await TOKENIN.balanceOf(buyer1.address);
            buyer1_TOKEN_balance_BEFORE = buyer1_TOKEN_balance_BEFORE/10**18;

            tx = await TOKENIN.approve(escrow.address, amountInMax);
            tx = await escrow
                    .connect(buyer1)
                    .createOrderWithTokensToStable(seller1.address, amountOut, amountInMax, tokenIn);
            let revertedTx = escrow.connect(buyer1).createOrderWithTokensToStable(buyer2.address, amountOut, amountInMax, tokenIn);
            expect(revertedTx).to.be.reverted;

            let buyer1_TOKEN_balance_AFTER = await TOKENIN.balanceOf(buyer1.address);
            buyer1_TOKEN_balance_AFTER = buyer1_TOKEN_balance_AFTER/10**18;
            
            let amount_TOKENINsent = amountInMax/10**18;
            let amount_TOKENINsent_real = buyer1_TOKEN_balance_BEFORE - buyer1_TOKEN_balance_AFTER;
            let priceTOKENIN_paid = amountOut_AMOUNT/amount_TOKENINsent_real;
            let actual_spent = priceTOKENIN_real*amount_TOKENINsent_real;
            let slippage = (actual_spent-amountOut_AMOUNT)*100/amountOut_AMOUNT;
            let spent = priceTOKENIN_paid*amount_TOKENINsent_real;
            let usdInFees = actual_spent-spent;

            // console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
            // console.log("JOE SENT: " + amount_TOKENINsent.toFixed(3));
            // console.log("REAL JOE PRICE: " + priceTOKENIN_real.toFixed(3) + "$");
            // console.log("PAID JOE PRICE: " + priceTOKENIN_paid.toFixed(3) + "$");
            // console.log("ACTUALLY HAVE SPENT: " + actual_spent.toFixed(3) + "$");
            // console.log("USD OBTAINED: " + spent.toFixed(3) + "$ (" + usdInFees.toFixed(3) + "$ total fees)");
            // console.log("SLIPPAGE: " + slippage.toFixed(3) + "%");
            // console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
            
            expect(slippage).to.be.lessThanOrEqual(slippageTolerance);
        });
    })

    describe("Order interactions", async () => {
        it("UT07 - Seller ships the order", async () => {
            await escrow
                .connect(seller1)
                .shipOrder(0);
            let orderLogs = await escrow.getLogsOfOrder(0);
            let lastLog = orderLogs.at(-1);
            expect(lastLog.state).to.equal(shipped)
        })

        it("UT08 - Buyer confirms the order", async () => {
            await escrow
                .connect(seller1)
                .shipOrder(0);
            let escrow_balance_USD_BEFORE = await STABLECOIN.balanceOf(escrow.address);
            let seller1_balance_USD_BEFORE = await STABLECOIN.balanceOf(seller1.address);
            await escrow
                .connect(buyer1)
                .confirmOrder(0);
            // let revertedTx = escrow.connect(seller1).shipOrder(0);
            // expect(revertedTx).to.be.reverted;
            let escrow_balance_USD_AFTER = await STABLECOIN.balanceOf(escrow.address);
            let seller1_balance_USD_AFTER = await STABLECOIN.balanceOf(seller1.address);

            let orderLogs = await escrow.getLogsOfOrder(0);
            let lastLog = orderLogs.at(-1);

            expect(lastLog.state).to.equal(confirmed)
            expect(escrow_balance_USD_BEFORE.sub(escrow_balance_USD_AFTER)).to.equal(orders[0].amount) // token sent from escrow to seller
            expect(seller1_balance_USD_AFTER.sub(seller1_balance_USD_BEFORE)).to.equal(orders[0].amount) // token received by seller
        })

        it("UT09 - Seller deletes the order", async () => {
            let escrow_balance_USD_BEFORE = await STABLECOIN.balanceOf(escrow.address);
            let buyer1_balance_USD_BEFORE = await STABLECOIN.balanceOf(buyer1.address);
            await escrow
                .connect(seller1)
                .deleteOrder(0);
            let escrow_balance_USD_AFTER = await STABLECOIN.balanceOf(escrow.address);
            let buyer1_balance_USD_AFTER = await STABLECOIN.balanceOf(buyer1.address);
            
            let orderLogs = await escrow.getLogsOfOrder(0);
            let lastLog = orderLogs.at(-1);
            
            expect(lastLog.state).to.equal(deleted)
            expect(escrow_balance_USD_BEFORE.sub(escrow_balance_USD_AFTER)).to.equal(orders[0].amount) // token sent from escrow to seller
            expect(buyer1_balance_USD_AFTER.sub(buyer1_balance_USD_BEFORE)).to.equal(orders[0].amount) // token received by buyer
        })

        it("UT10 - Buyer asks refund for the order (state: created)", async () => {
            let escrow_balance_USD_BEFORE = await STABLECOIN.balanceOf(escrow.address);
            let buyer1_balance_USD_BEFORE = await STABLECOIN.balanceOf(buyer1.address);
            await escrow
                .connect(buyer1)
                .askRefund(0);
            let escrow_balance_USD_AFTER = await STABLECOIN.balanceOf(escrow.address);
            let buyer1_balance_USD_AFTER = await STABLECOIN.balanceOf(buyer1.address);
            
            let orderLogs = await escrow.getLogsOfOrder(0);
            let logBeforeLast = orderLogs[orderLogs.length -2];
            let lastLog = orderLogs.at(-1);
            
            expect(logBeforeLast.state).to.equal(refundAsked)
            expect(lastLog.state).to.equal(refunded)
            expect(escrow_balance_USD_BEFORE.sub(escrow_balance_USD_AFTER)).to.equal(orders[0].amount) // token sent from escrow to seller
            expect(buyer1_balance_USD_AFTER.sub(buyer1_balance_USD_BEFORE)).to.equal(orders[0].amount) // token received by seller
        })

        it("UT11 - Seller refunds the buyer", async () => {
            await escrow
                .connect(seller1)
                .shipOrder(0);
            await escrow
                .connect(buyer1)
                .confirmOrder(0);
            await escrow
                .connect(buyer1)
                .askRefund(0);

            await STABLECOIN.connect(seller1).approve(escrow.address, orders[0].amount);

            let seller1_balance_USD_BEFORE = await STABLECOIN.balanceOf(seller1.address);
            let buyer1_balance_USD_BEFORE = await STABLECOIN.balanceOf(buyer1.address);
            await escrow
                .connect(seller1)
                .refundBuyer(0, orders[0].amount);
            let seller1_balance_USD_AFTER = await STABLECOIN.balanceOf(seller1.address);
            let buyer1_balance_USD_AFTER = await STABLECOIN.balanceOf(buyer1.address);

            let orderLogs = await escrow.getLogsOfOrder(0);
            let lastLog = orderLogs.at(-1);   

            expect(lastLog.state).to.equal(refunded)
            expect(seller1_balance_USD_BEFORE.sub(seller1_balance_USD_AFTER)).to.equal(orders[0].amount) // token sent from seller to buyer
            expect(buyer1_balance_USD_AFTER.sub(buyer1_balance_USD_BEFORE)).to.equal(orders[0].amount) // token received by buyer
        })
    })

    describe("Setters", async () => {
        it("UT12 - setStablecoinDataFeed()", async () => {
            let btcDataFeed = "0x2779D32d5166BAaa2B2b658333bA7e6Ec0C65743";
            expect(escrow.setStablecoinDataFeed(btcDataFeed)).to.be.revertedWith("ERROR: You're changing the data feed to a non-stablecoin watcher.");
            let ustDataFeed = "0xf58B78581c480caFf667C63feDd564eCF01Ef86b";
            await escrow.setStablecoinDataFeed(ustDataFeed);
            let pegged = await escrow.stablecoinIsPegged();
            expect(pegged).to.be.true;
        })
        it("UT13 - setStablecoinAddress()", async () => {
            let ustAddress = "0xb599c3590F42f8F995ECfa0f85D2980B76862fc1";
            await escrow.setStablecoinAddress(ustAddress);
            let newSTABLECOIN = await escrow.STABLECOIN();
            expect(newSTABLECOIN).to.equal(ustAddress);
        })
        it("UT14 - setStablecoinPegThreshold()", async () => {
            let newThreshold = etherToWei("0.03");
            await escrow.setStablecoinPegThreshold(newThreshold);
            let pegThreshold = await escrow.pegThreshold();
            expect(pegThreshold).to.equal(newThreshold);
        })
    })

    describe('Getters', async () => {
        it("UT15 - Returns all orders of a buyer given his address", async () => {
            let ordersBuyer1 = await escrow.getOrdersOfUser(buyer1.address);
            assert(ordersBuyer1.length > 0);
            expect(ordersBuyer1[0].buyer).to.equal(buyer1.address);
        })

        it("UT16 - Returns all orders of a seller given his address", async () => {
            let ordersSeller1 = await escrow.getOrdersOfUser(seller1.address);
            assert(ordersSeller1.length > 0);
            expect(ordersSeller1[0].seller).to.equal(seller1.address);
        })

        it("UT17 - Reverts if asking orders of unregistered user", async () => {
            expect(escrow.getOrdersOfUser(buyer3.address)).to.be.revertedWith("This user is not registered in our platform.");
        })

        it("UT18 - Returns the right number of sellers", async () => {
            let nSellers = await escrow.getTotalSellers();
            expect(nSellers).to.equal(registeredSellers);
        })

        it("UT19 - Returns the orders", async () => {
            let order = await escrow.getOrder(0);
            expect(order.id).to.equal(0);
        })

        it("UT20 - Returns the smart contract balance", async () => {
            let balance = await escrow.getBalance();
            expect(balance).to.be.not.null;
        })

        it("UT21 - Returns the orders counter", async () => {
            let counter = await escrow.getTotalOrders();
            expect(counter).to.equal(3);
        })

        it("UT22 - Checks stablecoin price with Chainlink and returns true if it's pegged to USD", async () => {
            let pegged = await escrow.stablecoinIsPegged();
            expect(pegged).to.be.true;
        })
    })

    describe("Else branches", async () => {
        it("UT23 - Reverts correctly with modifiers and other statements checks", async () => {
            let btcDataFeed = "0x2779D32d5166BAaa2B2b658333bA7e6Ec0C65743";
            tx = escrow.connect(buyer1).setStablecoinDataFeed(btcDataFeed);
            expect(tx).to.be.reverted;

            tx = escrow.connect(seller1).shipOrder(99);
            expect(tx).to.be.reverted;

            tx = escrow.deleteOrder(0, {from: seller2});
            expect(tx).to.be.reverted;

            tx = escrow.connect(seller2).shipOrder(0);
            expect(tx).to.be.reverted;

            tx = escrow.connect(seller2).askRefund(0);
            expect(tx).to.be.reverted;

            tx = escrow.setStablecoinDataFeed(STABLECOIN);
            expect(tx).to.be.reverted;
        })
    })

})
