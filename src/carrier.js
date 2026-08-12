import { linkMap, validateAset } from "./model.js";

const ABIT_BY_REF = Object.freeze({
  O: "[",
  C: "]",
  L: "1",
  U: "0",
});

export class CarrierInputError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export function carrierFromProvenance(aset) {
  const carrier = aset?.provenance?.representations?.carrier;
  if (typeof carrier !== "string" || carrier.length === 0) {
    throw new CarrierInputError(
      "carrier-not-selected",
      "В асети не указан provenance.representations.carrier",
    );
  }
  return carrier;
}

export function readRootedCarrier(aset, carrier) {
  const errors = validateAset(aset);
  if (errors.length) {
    throw new CarrierInputError("invalid-aset", errors.join("; "));
  }
  if (typeof carrier !== "string" || carrier.length === 0) {
    throw new CarrierInputError("carrier-not-selected", "Не выбрана связь-носитель");
  }

  const links = linkMap(aset);
  if (!links.has(carrier)) {
    throw new CarrierInputError("unknown-carrier", `Неизвестная связь-носитель: ${carrier}`);
  }
  if (carrier === aset.root) {
    return { carrier, values: [], prefixes: [aset.root] };
  }

  const reversedValues = [];
  const reversedPrefixes = [carrier];
  const visited = new Set();
  let current = carrier;

  while (current !== aset.root) {
    if (visited.has(current)) {
      throw new CarrierInputError(
        "not-rooted-sequence",
        "Выбранная связь не задаёт конечную start-историю от акорня",
      );
    }
    visited.add(current);
    const link = links.get(current);
    if (!link) {
      throw new CarrierInputError("not-rooted-sequence", `Разорвана start-история: ${current}`);
    }
    reversedValues.push(link.end);
    current = link.start;
    reversedPrefixes.push(current);
  }

  return {
    carrier,
    values: reversedValues.reverse(),
    prefixes: reversedPrefixes.reverse(),
  };
}

export function decodeCarrierStream(aset, carrier) {
  const sequence = readRootedCarrier(aset, carrier);
  const symbols = sequence.values.map((ref) => {
    const symbol = ABIT_BY_REF[ref];
    if (symbol === undefined) {
      throw new CarrierInputError(
        "non-abit",
        `Связь ${ref} в carrier не является одним из корневых абитов O/C/L/U`,
      );
    }
    return symbol;
  });
  return {
    source: symbols.join(""),
    sequence,
  };
}
