import {
  method,
  isReady,
  Mina,
  PrivateKey,
  shutdown,
  AccountUpdate,
  Field,
  SmartContract,
  CircuitValue,
  matrixProp,
} from 'snarkyjs';

// matrix setup
// the error is thrown only if inputDIms rows are a big number
// runs fine if its say 64 or something similar
let inputDims = {
  rows: 64000,
  cols: 3,
};

let weightDims = {
  rows: 3,
  cols: 64,
};

// helper methods / classes
let createMatrix = (rows: number, cols: number, fill: number): Field[][] => {
  let matrix = Array.from(Array(rows), () => Array(cols).fill(fill));
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
  // if it is not @state, where will this be saved? npm package?
  w1: Field[][] = createMatrix(weightDims.rows, weightDims.cols, 1);

  // multiply two matrices: a and b
  matrix_mul(a: Field[][], b: Field[][]): Field[][] {
    let [aRows, aCols] = [a.length, a[0].length];
    let [bRows, bCols] = [b.length, b[0].length];
    console.log(`
      x[${aRows}][${aCols}] *
      w[${bRows}][${bCols}] =
      [${bRows}][${bCols}]`);

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

  @method multiply(input: Input) {
    let res = this.matrix_mul(input.value, this.w1);
  }
}

// setup
await isReady;
const Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);

const account = Local.testAccounts[0].privateKey;
const zkappKey = PrivateKey.random();
let zkappAddress = zkappKey.toPublicKey();

console.log('Compiling smart contract...');
let { verificationKey } = await SimpleZkapp.compile();
let zkapp = new SimpleZkapp(zkappAddress);

console.log(`Deploying zkapp for public key ${zkappAddress.toBase58()}.`);
let tx = await Mina.transaction(account, () => {
  AccountUpdate.fundNewAccount(account);
  zkapp.deploy({ zkappKey, verificationKey });
});
await tx.send().wait();

console.log(`Call the method 'multiply'`);
let tx_ = await Mina.transaction(account, () => {
  // have to pass it as matrixprop, else will get
  // Argument 1 of method multiply is not a valid circuit value
  let input_ = createMatrix(inputDims.rows, inputDims.cols, 1);
  zkapp.multiply(new Input(input_));
});

// fill in the proof - this can take a while...
console.log('Creating an execution proof...');
await tx_.prove();

// send the transaction to the graphql endpoint
console.log('Sending the transaction...');
await tx_.send().wait();

shutdown();
