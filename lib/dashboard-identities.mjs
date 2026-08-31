const PIN_HASH_ITERATIONS = 310000;
const PIN_HASH_SALT = "E7SHLhCxUHf_PCqn0pty740N";

export const DASHBOARD_IDENTITY_AUTH_VERSION = 1;

const dashboardIdentities = Object.freeze(
  [
  {
    "id": "adrian-reed",
    "name": "Adrian Reed",
    "role": "employee",
    "pinHash": "459a91c485ff06ba31017bbce89cbe7db7bbe7abb96683fd601266bcfa9d39ef"
  },
  {
    "id": "alexis-younker",
    "name": "Alexis Younker",
    "role": "employee",
    "pinHash": "b84b2f2ec537321666707e22f62b478f0ae593de944d3960c08a6e9d3391edc2"
  },
  {
    "id": "ashleigh-shock",
    "name": "Ashleigh Shock",
    "role": "employee",
    "pinHash": "d943f0782d75ea2bc8fb5dd9a7eee2a1a41615aac4744ecc935b5e4497e75494"
  },
  {
    "id": "austin-weimer",
    "name": "Austin Weimer",
    "role": "employee",
    "pinHash": "1d7504acefce24c55c565bb585e880467c13b63ef66cc5227ddc85c8c0a989ca"
  },
  {
    "id": "brooke-swallows",
    "name": "Brooke Swallows",
    "role": "employee",
    "pinHash": "2fd930caf2ffe04f8a82a222ccf64c48608c648c746371e0f62e29cac454472c"
  },
  {
    "id": "cameron-reilly",
    "name": "Cameron Reilly",
    "role": "employee",
    "pinHash": "685471b78dbe48acbb9516fef3a6bb6e0e2bf65b674c117c46b1de0199d837e3"
  },
  {
    "id": "carlos-chavando",
    "name": "Carlos Chavando",
    "role": "owner",
    "pinHash": "f3ecb6c6873e025fe9665974bd0bc35e5bc607647daa3e6d7d6e2a45cfca5889"
  },
  {
    "id": "chase-walker",
    "name": "Chase Walker",
    "role": "employee",
    "pinHash": "9f300894c7285de8a13f144a78a85dd056d7f33b480187117586c00e5f96a1a5"
  },
  {
    "id": "christina-myers",
    "name": "Christina Myers",
    "role": "employee",
    "pinHash": "49ef836327b1d66bfe6108b6bc50fd435d8788b870c0e43daa06ea17997e654e"
  },
  {
    "id": "crisanta-alanis-mejias",
    "name": "Crisanta Alanis Mejias",
    "role": "employee",
    "pinHash": "0e3885dfe10ce5b0953726fa344a2202e709c2103cfc1c7d2d8e5fe46cdcd927"
  },
  {
    "id": "daniel-huiet",
    "name": "Daniel Huiet",
    "role": "owner",
    "pinHash": "515e0f286fab43137024f8bd5fccc7dac24249f169527965e49be674aebc9da1"
  },
  {
    "id": "derek-pethel",
    "name": "Derek Pethel",
    "role": "owner",
    "pinHash": "e76badcc714b4cee7066b2a62a52cd31837e99dc3e6792b39d65ebd8f182551c"
  },
  {
    "id": "diana-montes",
    "name": "Diana Montes",
    "role": "employee",
    "pinHash": "d550be3663f889962406cda7c8e38471c36b1178bb70ee34c36ee5018f6b7634"
  },
  {
    "id": "emily-hall",
    "name": "Emily Hall",
    "role": "employee",
    "pinHash": "fde1a6435f04af9c77373c4dc3b3b605702a97a7c6892198e2903c745a874f20"
  },
  {
    "id": "enrique-martinez",
    "name": "Enrique Martinez",
    "role": "employee",
    "pinHash": "91bd27c7cfac1ae19defbbe0576f18d07b975b92043f0a251a5dee8f08c9aa62"
  },
  {
    "id": "estuardo-cinto-lopez",
    "name": "Estuardo Cinto Lopez",
    "role": "employee",
    "pinHash": "74b69b11a725d3b75c3bcf3896649650fab56b10b08725146493866ace3cf38b"
  },
  {
    "id": "geldy-lopez-cinto",
    "name": "Geldy Lopez Cinto",
    "role": "employee",
    "pinHash": "cfe46b8854e15c70f75b8f8a81200a0b10b4f60f2f1058b27dec7ec26b8ae9d6"
  },
  {
    "id": "jasmonica-gallegos",
    "name": "Jasmonica Gallegos",
    "role": "employee",
    "pinHash": "8ec77e3bf8e5758e3fdffa809985687a70b79a4d408b10128176d2a2a0a3019e"
  },
  {
    "id": "julio-guardian",
    "name": "Julio Guardian",
    "role": "employee",
    "pinHash": "08ef1174cffbc587793436bffef52a9a7d88d72d3aa9459fec059da66ebfeaa1"
  },
  {
    "id": "kaleb-wofford",
    "name": "Kaleb Wofford",
    "role": "employee",
    "pinHash": "5d981215d7426aba81a6e7de6543f8b7f33308255774fdd107fe003fdec4d27c"
  },
  {
    "id": "karla-lopez",
    "name": "Karla Lopez",
    "role": "employee",
    "pinHash": "4e9e5b43deb548799c50a3370c9ca8c963752b5c6c038d3c228a81557f6691ca"
  },
  {
    "id": "lindsey-hoff",
    "name": "Lindsey Hoff",
    "role": "employee",
    "pinHash": "19420860229afa9517da54fe0be80c830c35b14f335914e544fd2a7a9858257f"
  },
  {
    "id": "molly-adams",
    "name": "Molly Adams",
    "role": "employee",
    "pinHash": "a63ad8edab5552014aa2774ddfd585708b3027648367f457e215a1bfc3294911"
  },
  {
    "id": "rocky-stark",
    "name": "Rocky Stark",
    "role": "employee",
    "pinHash": "d30ec08007b86465deb9a4e556d5e386e46d2f3dcb0462f334b1b6da1cf62c8a"
  },
  {
    "id": "ryan-murphy",
    "name": "Ryan Murphy",
    "role": "employee",
    "pinHash": "aa46aa93a6385f2715431ef4d43c64036a3cfb4a8a483f07b532092d58037f8e"
  },
  {
    "id": "samantha-watkins",
    "name": "Samantha Watkins",
    "role": "owner",
    "pinHash": "83be011b295229c9a270a408f0ab893c439bf392c4f8ce809937ee926ce48c1a"
  },
  {
    "id": "saul-martinez",
    "name": "Saul Martinez",
    "role": "employee",
    "pinHash": "346b5b3b8661b54cf3ecacf44bda4d6c8b5f6f52518f861e0d53e44593226af4"
  },
  {
    "id": "sean-dobbins",
    "name": "Sean Dobbins",
    "role": "employee",
    "pinHash": "d09b87419161ea149634243a954336573a323c3f7289d44b0ba9166758166a27"
  },
  {
    "id": "selena-cepeda",
    "name": "Selena Cepeda",
    "role": "employee",
    "pinHash": "9d2438f28728f5451b5d0353c61b2ddf8ecd4da143e8cf28bf17577dcfc53878"
  },
  {
    "id": "staci-buck",
    "name": "Staci Buck",
    "role": "employee",
    "pinHash": "841854abaa83609ab3fdc340b0920d49c34136f3ab97d629abe269fff3bfeb8f"
  },
  {
    "id": "taylor-houseman",
    "name": "Taylor Houseman",
    "role": "employee",
    "pinHash": "37b864763e3d01b1cdd4cc0c2bb54621cf143b424fb2911f9f0b3b3bf2f81267"
  },
  {
    "id": "veronica-vargas",
    "name": "Veronica Vargas",
    "role": "employee",
    "pinHash": "00be43df083e54da86711b0e151a3e65ee3bcb00ad62c1addfc73ded71f3cf4d"
  }
].map((entry) => Object.freeze(entry)),
);

function clean(value) {
  return String(value ?? "").trim();
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  const leftValue = String(left ?? "");
  const rightValue = String(right ?? "");
  const length = Math.max(leftValue.length, rightValue.length);
  let difference = leftValue.length ^ rightValue.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftValue.charCodeAt(index) || 0) ^ (rightValue.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function hashClockInNumber(clockInNumber) {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(clockInNumber),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(PIN_HASH_SALT),
      iterations: PIN_HASH_ITERATIONS,
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export function getDashboardIdentityCoverage() {
  return {
    total: dashboardIdentities.length,
    admins: dashboardIdentities.filter((entry) => entry.role === "owner").length,
    staff: dashboardIdentities.filter((entry) => entry.role === "employee").length,
  };
}

export function getDashboardIdentityById(id) {
  return dashboardIdentities.find((entry) => entry.id === clean(id)) || null;
}

export async function matchDashboardIdentityPin(value) {
  const clockInNumber = clean(value);
  if (!/^\d{4}$/.test(clockInNumber)) return null;

  const submittedHash = await hashClockInNumber(clockInNumber);
  let match = null;
  dashboardIdentities.forEach((entry) => {
    if (constantTimeEqual(submittedHash, entry.pinHash)) match = entry;
  });
  return match ? { id: match.id, name: match.name, role: match.role } : null;
}
