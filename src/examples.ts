export const examples = [
  {
    id: "adaptive",
    name: "Pipeline · three stages, fixed placement",
    entry: "@pipeline",
    source: `module Adaptive;

fn heavy(xs: List<u32>) -> List<u32> {
    return xs.map(fn(x) => repeat(512, x,
        fn(i) => fn(v) => v * 1664525 + 1013904223 + i));
}
fn adjust(xs: List<u32>) -> List<u32> {
    return xs.map(fn(x) => x * 2 + 1);
}
fn total(xs: List<u32>) -> u32 { return sum(xs); }
`,
    input: JSON.stringify({
      inputs: { data: Array.from({ length: 8192 }, (_, i) => i) },
      steps: [
        { id: "heavy", call: "heavy", args: [{ input: "data" }] },
        { id: "adjust", call: "adjust", args: [{ step: "heavy" }] },
        { id: "total", call: "total", args: [{ step: "adjust" }] },
      ],
      outputs: ["total"],
    }),
  },
  {
    id: "prices",
    name: "State · prices and a total",
    entry: "@script",
    source: `module prices;

state Prices: Table<u64, u64> = Table.empty();
keep total_price: u64 = sum(Prices.values());

change set_price(item: u64, price: u64)
    -> Result<Unit, String> writes(Prices)
{
    Prices.put(item, price);
    return Ok(());
}

query total() -> u64 reads(total_price) {
    return total_price;
}
`,
    input: JSON.stringify(
      [
        { call: "set_price", args: [1, 40] },
        { call: "set_price", args: [2, 60] },
        { call: "total", args: [] },
        { call: "set_price", args: [1, 45] },
        { call: "total", args: [] },
      ],
      null,
      2,
    ),
  },
  {
    id: "pipeline",
    name: "Compute · map, filter and sum",
    entry: "total",
    source: `module pipeline;

fn total(xs: List<u32>, scale: u32) -> u32 {
    return sum(xs.map(fn(x) => x * scale)
                 .filter(fn(x) => x > 100));
}

fn transformed(xs: List<u32>) -> List<u32> {
    return xs.map(fn(x) => x * 3 + 7);
}
`,
    input: JSON.stringify([Array.from({ length: 2048 }, (_, i) => i), 3]),
  },
  {
    id: "generic",
    name: "Generics · collect before constructing",
    entry: "selected",
    source: `module collection;

record Row { id: u32, score: u32, }

fn collect<T, U>(xs: List<T>, keep: fn(T)->Bool,
                 build: fn(T)->U) -> List<U> {
    var out: Buffer<U> = Buffer.empty();
    for item in xs {
        if keep(item) { out = out.push(build(item)); }
    }
    return out.freeze();
}

fn selected(xs: List<Row>) -> List<Row> {
    return collect<Row, Row>(xs,
        fn(row) => row.score > 10,
        fn(row) => Row { id: row.id, score: row.score + 1 });
}
`,
    input: JSON.stringify(
      [
        [
          { id: 1, score: 5 },
          { id: 2, score: 20 },
          { id: 3, score: 15 },
        ],
      ],
      null,
      2,
    ),
  },
  {
    id: "rollback",
    name: "Transactions · a failed change rolls back",
    entry: "@script",
    source: `module counter;

enum Error { Failed, }
state Counters: Table<u64, u64> = Table.empty();

change set(key: u64, value: u64)
    -> Result<Unit, Error> writes(Counters) {
    if Counters.contains(key) { Counters.replace(key, value); }
    else { Counters.insert(key, value); }
    return Ok(());
}

change rejected(key: u64) -> Result<Unit, Error> writes(Counters) {
    Counters.remove(key);
    return Err(Error.Failed);
}

query get(key: u64) -> Option<u64> reads(Counters) {
    return Counters.get(key);
}
`,
    input: JSON.stringify(
      [
        { call: "set", args: [7, 42] },
        { call: "rejected", args: [7] },
        { call: "get", args: [7] },
      ],
      null,
      2,
    ),
  },
  {
    id: "contracts",
    name: "Contracts · two proved implementations",
    entry: "next",
    source: `module Contracts;

spec fn next(x:u32)->u32 ensures result == x+1;
implementation direct for next { return x+1; }
implementation commuted for next { return 1+x; }

fn distinct(xs:List<u32>)->Bool { return unique(xs); }
fn same_bag(xs:List<u32>,ys:List<u32>)->Bool {
    return multiset(xs) == multiset(ys);
}
`,
    input: "[41]",
  },
];
