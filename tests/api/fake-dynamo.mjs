// A DynamoDB document client in memory, for the tests: enough of GetItem, PutItem,
// UpdateItem, DeleteItem and TransactWriteItems, with condition expressions evaluated,
// to run backend/api/dynamo-store.mjs and backend/reels/aws.mjs as they run on AWS.
// The grammar is what those files write: attribute_exists / attribute_not_exists,
// = <> < > <= >=, AND, OR and parentheses; SET a = :v, ... and ADD a :v.

const key = (k) => `${k.pk}|${k.sk}`;

class ConditionalCheckFailedException extends Error {
  name = "ConditionalCheckFailedException";
}
class TransactionCanceledException extends Error {
  name = "TransactionCanceledException";
  constructor(reasons) {
    super("Transaction cancelled");
    this.CancellationReasons = reasons;
  }
}

function tokens(text) {
  const out = [];
  const re =
    /\s*(attribute_not_exists|attribute_exists|AND|OR|<>|<=|>=|[()=<>,]|[#:][A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_]*)/y;
  let m;
  while (re.lastIndex < text.length && (m = re.exec(text))) out.push(m[1]);
  if (re.lastIndex < text.trimEnd().length)
    throw new Error(`cannot read condition: ${text}`);
  return out;
}

const same = (a, b) =>
  Buffer.isBuffer(a) || a instanceof Uint8Array
    ? Buffer.compare(Buffer.from(a), Buffer.from(b ?? [])) === 0
    : a === b;

export function evaluate(expr, item, names = {}, values = {}) {
  if (!expr) return true;
  const t = tokens(expr);
  let i = 0;
  const name = (tok) => names[tok] ?? tok;
  const operand = () => {
    const tok = t[i++];
    if (tok.startsWith(":")) return { value: values[tok] };
    const attr = name(tok);
    return { value: item?.[attr], present: item != null && attr in item };
  };
  const primary = () => {
    if (t[i] === "(") {
      i++;
      const v = or();
      i++; // )
      return v;
    }
    if (t[i] === "attribute_exists" || t[i] === "attribute_not_exists") {
      const fn = t[i];
      i += 2; // fn (
      const attr = name(t[i++]);
      i++; // )
      const has = item != null && attr in item;
      return fn === "attribute_exists" ? has : !has;
    }
    const a = operand();
    const op = t[i++];
    const b = operand();
    if (a.value === undefined || b.value === undefined) return op === "<>";
    switch (op) {
      case "=":
        return same(a.value, b.value);
      case "<>":
        return !same(a.value, b.value);
      case "<":
        return a.value < b.value;
      case ">":
        return a.value > b.value;
      case "<=":
        return a.value <= b.value;
      case ">=":
        return a.value >= b.value;
    }
    throw new Error(`operator ${op}`);
  };
  const and = () => {
    let v = primary();
    while (t[i] === "AND") {
      i++;
      const w = primary();
      v = v && w;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (t[i] === "OR") {
      i++;
      const w = and();
      v = v || w;
    }
    return v;
  };
  return or();
}

function update(item, expr, names = {}, values = {}) {
  const next = { ...item };
  const parts = expr.split(/\s+(?=SET\s|ADD\s)/);
  for (const part of parts) {
    const [verb, ...rest] = part.trim().split(/\s+/);
    const body = rest.join(" ");
    for (const clause of body.split(/\s*,\s*/)) {
      if (verb === "SET") {
        const [a, v] = clause.split(/\s*=\s*/);
        next[names[a] ?? a] = values[v];
      } else if (verb === "ADD") {
        const [a, v] = clause.split(/\s+/);
        const attr = names[a] ?? a;
        next[attr] = (next[attr] ?? 0) + values[v];
      } else throw new Error(`update verb ${verb}`);
    }
  }
  return next;
}

export function fakeDynamo() {
  const items = new Map();
  const calls = [];
  const copy = (x) => (x ? structuredClone(x) : x);

  function put({
    Item,
    ConditionExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  }) {
    const had = items.get(key(Item));
    if (
      !evaluate(
        ConditionExpression,
        had,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
      )
    )
      throw new ConditionalCheckFailedException(
        "The conditional request failed",
      );
    items.set(key(Item), copy(Item));
  }

  const ops = {
    GetCommand({ Key, ProjectionExpression, ExpressionAttributeNames = {} }) {
      const had = copy(items.get(key(Key)));
      if (!had || !ProjectionExpression) return { Item: had };
      const keep = ProjectionExpression.split(/\s*,\s*/).map(
        (n) => ExpressionAttributeNames[n] ?? n,
      );
      return {
        Item: Object.fromEntries(
          Object.entries(had).filter(([k]) => keep.includes(k)),
        ),
      };
    },
    PutCommand(input) {
      put(input);
      return {};
    },
    UpdateCommand({
      Key,
      UpdateExpression,
      ConditionExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues,
    }) {
      const had = items.get(key(Key));
      if (
        !evaluate(
          ConditionExpression,
          had,
          ExpressionAttributeNames,
          ExpressionAttributeValues,
        )
      )
        throw new ConditionalCheckFailedException(
          "The conditional request failed",
        );
      const next = update(
        had ?? { ...Key },
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
      );
      items.set(key(Key), next);
      return ReturnValues === "UPDATED_NEW" ? { Attributes: copy(next) } : {};
    },
    DeleteCommand({
      Key,
      ConditionExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    }) {
      const had = items.get(key(Key));
      if (
        !evaluate(
          ConditionExpression,
          had,
          ExpressionAttributeNames,
          ExpressionAttributeValues,
        )
      )
        throw new ConditionalCheckFailedException(
          "The conditional request failed",
        );
      items.delete(key(Key));
      return {};
    },
    TransactWriteCommand({ TransactItems }) {
      const reasons = TransactItems.map(({ Put }) => {
        const had = items.get(key(Put.Item));
        return evaluate(
          Put.ConditionExpression,
          had,
          Put.ExpressionAttributeNames,
          Put.ExpressionAttributeValues,
        )
          ? { Code: "None" }
          : { Code: "ConditionalCheckFailed" };
      });
      if (reasons.some((r) => r.Code !== "None"))
        throw new TransactionCanceledException(reasons);
      for (const { Put } of TransactItems)
        items.set(key(Put.Item), copy(Put.Item));
      return {};
    },
  };

  return {
    items,
    calls,
    async send(command) {
      const op = command.constructor.name;
      calls.push({ op, input: command.input });
      if (!ops[op]) throw new Error(`fake DynamoDB has no ${op}`);
      return ops[op](command.input);
    },
  };
}
