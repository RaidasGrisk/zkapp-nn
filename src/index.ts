import {
  state,
  State,
  method,
  isReady,
  Mina,
  PrivateKey,
  PublicKey,
  shutdown,
  AccountUpdate,
  Field,
  SmartContract,
  CircuitValue,
  matrixProp,
} from 'snarkyjs';

// if model weights are [12288, 128]
// input dims are    [1, 12288]
// import { weights } from './weights.js'
// console.log(`model weights : [${weights.w1.length}][${weights.w1[0].length}]`)

let inputDims = {
  rows: 400000,
  cols: 3,
};
let weightDims = {
  rows: 3,
  cols: 400000,
};

let createMatrix = (nRows: number, nCols: number, fill: number): Field[][] => {
  let matrix = Array.from(Array(nRows), () => Array(nCols).fill(fill));
  matrix = matrix.map((row) => row.map(Field));
  return matrix;
};

class Input extends CircuitValue {
  @matrixProp(Field, inputDims.rows, inputDims.cols) value: Field[][];
  constructor(matrix: Field[][]) {
    super();
    this.value = matrix;
  }
}

class SimpleZkapp extends SmartContract {
  @state(PublicKey) pubKey = State<PublicKey>();
  w1: Field[][] = createMatrix(weightDims.rows, weightDims.cols, 1);

  // multiply two matrices: a and b
  matrix_mul(a: Field[][], b: Field[][]): Field[][] {
    // assert matrices
    let [aRows, aCols] = [a.length, a[0].length];
    let [bRows, bCols] = [b.length, b[0].length];
    console.log(`
      x[${aRows}][${aCols}] *
      w[${bRows}][${bCols}] =
      [${bRows}][${bCols}]`);
    if (!(aCols === bRows)) {
      throw 'bad dims';
    }

    // init output matrix
    /* eslint-disable no-unused-vars */
    var res: Field[][] = [];
    var i, j, k;
    for (i = 0; i < aRows; i++) {
      res[i] = Array(aCols).fill(Field.zero);
      for (j = 0; j < aCols; j++) {
        res[i][j] = Field.zero;
      }
    }

    // compute output matrix
    for (i = 0; i < aRows; i++) {
      for (j = 0; j < aCols; j++) {
        for (k = 0; k < bRows; k++) {
          res[k][j] = res[k][j].add(a[i][j].mul(b[k][i]));
        }
      }
    }
    return res;
  }

  @method update(input: Input, pubKey: PublicKey) {
    // matrix mult
    let res = this.matrix_mul(input.value, this.w1);

    // assert and update state
    let pubKey_ = this.pubKey.get();
    this.pubKey.assertEquals(pubKey_);
    this.pubKey.set(pubKey);
    console.log('FINISH METHOD');
  }
}

// setup
await isReady;
const Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);

const account = Local.testAccounts[0].privateKey;
const zkappKey = PrivateKey.random();
let zkappAddress = zkappKey.toPublicKey();

// have to compile if using proofs?
// https://github.com/o1-labs/snarkyjs/blob/main/src/examples/zkapps/simple_and_counter_zkapp.ts
console.log('Compiling smart contract...');
let { verificationKey } = await SimpleZkapp.compile();

let zkapp = new SimpleZkapp(zkappAddress);

console.log(`Deploying zkapp for public key ${zkappAddress.toBase58()}.`);
let tx = await Mina.transaction(account, () => {
  AccountUpdate.fundNewAccount(account);
  zkapp.deploy({ zkappKey, verificationKey });
});
await tx.send().wait();

// https://github.com/o1-labs/snarkyjs/blob/main/src/examples/zkapps/hello_world/run.ts
console.log('Initial State', zkapp.pubKey.get().toBase58());
console.log(`Update state`);
let tx_ = await Mina.transaction(account, () => {
  // have to pass it as matrixprop, else will get
  // Argument 1 of method update is not a valid circuit value
  let input_ = createMatrix(inputDims.rows, inputDims.cols, 1);
  zkapp.update(new Input(input_), account.toPublicKey());
});

// fill in the proof - this can take a while...
console.log('Creating an execution proof...');
await tx_.prove();

// send the transaction to the graphql endpoint
console.log('Sending the transaction...');
await tx_.send().wait();

console.log('Updated State', zkapp.pubKey.get().toBase58());

shutdown();
