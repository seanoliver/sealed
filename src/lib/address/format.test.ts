import { describe, expect, it } from "vitest";
import { envelopeLines, formatEnvelope, type PostalAddress } from "./format";

const blank: PostalAddress = {
  addressLine1: null,
  addressLine2: null,
  district: null,
  city: null,
  stateRegion: null,
  postalCode: null,
  countryCode: null,
};

const US = { senderCountry: "US" };

describe("envelopeLines", () => {
  it("prints a US address in US order without a country line when mailing from the US", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "1427 Linden Avenue",
          addressLine2: "Apt 3B",
          city: "Portland",
          stateRegion: "OR",
          postalCode: "97214",
          countryCode: "US",
        },
        { ...US, name: "Ada Lovelace" },
      ),
    ).toEqual(["Ada Lovelace", "1427 Linden Avenue, Apt 3B", "PORTLAND, OR 97214"]);
  });

  it("adds the country in capitals when mailing to the US from elsewhere", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "1 Main St",
          city: "Boston",
          stateRegion: "MA",
          postalCode: "02110",
          countryCode: "US",
        },
        { senderCountry: "GB" },
      )?.at(-1),
    ).toBe("UNITED STATES");
  });

  it("puts the UK flat first and the post town and postcode in capitals", () => {
    const envelope = formatEnvelope(
      {
        ...blank,
        addressLine1: "14 Kestrel Lane",
        addressLine2: "Flat 2",
        city: "Bristol",
        postalCode: "bs6 5qt",
        countryCode: "GB",
      },
      { ...US, name: "Priya Raman & Daniel Okafor" },
    );
    expect(envelope?.lines).toEqual([
      { text: "Priya Raman & Daniel Okafor", uppercased: false },
      { text: "Flat 2, 14 Kestrel Lane", uppercased: false },
      { text: "BRISTOL", uppercased: true },
      { text: "BS6 5QT", uppercased: true },
      { text: "UNITED KINGDOM", uppercased: false },
    ]);
  });

  it("puts the Dutch postcode before the city", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "Keizersgracht 212",
          city: "Amsterdam",
          postalCode: "1016 DZ",
          countryCode: "NL",
        },
        { ...US, name: "Sanne de Vries" },
      ),
    ).toEqual(["Sanne de Vries", "Keizersgracht 212", "1016 DZ Amsterdam", "NETHERLANDS"]);
  });

  it("writes a Chinese address in Chinese order: postcode first, name last with 收", () => {
    const envelope = formatEnvelope(
      {
        ...blank,
        stateRegion: "上海市",
        city: "上海市",
        district: "浦东新区",
        addressLine1: "张江路1500弄6号501室",
        postalCode: "201203",
        countryCode: "CN",
      },
      { ...US, name: "王芳" },
    );
    expect(envelope?.local).toBe(true);
    expect(envelope?.lines.map((line) => line.text)).toEqual([
      "201203",
      "上海市浦东新区",
      "张江路1500弄6号501室",
      "王芳 收",
      "CHINA",
    ]);
  });

  it("keeps a legacy China address that is all on the street line", () => {
    expect(
      envelopeLines(
        { ...blank, addressLine1: "上海市浦东新区张江路1500弄6号501室", countryCode: "CN" },
        { ...US, name: "王芳" },
      ),
    ).toEqual(["上海市浦东新区张江路1500弄6号501室", "王芳 收", "CHINA"]);
  });

  it("writes a China address in Latin letters in Western order", () => {
    const envelope = formatEnvelope(
      {
        ...blank,
        addressLine1: "1500 Zhangjiang Road, Lane 6, Room 501",
        district: "Pudong",
        city: "Shanghai",
        stateRegion: "Shanghai Shi",
        postalCode: "201203",
        countryCode: "CN",
      },
      { ...US, name: "Wang Fang" },
    );
    expect(envelope?.local).toBe(false);
    expect(envelope?.lines.map((line) => line.text)).toEqual([
      "Wang Fang",
      "1500 Zhangjiang Road, Lane 6, Room 501",
      "Pudong",
      "Shanghai",
      "SHANGHAI SHI, 201203",
      "CHINA",
    ]);
  });

  it("prints Singapore's fixed SINGAPORE line once", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "10 Anson Road #20-05",
          city: "Singapore",
          postalCode: "079903",
          countryCode: "SG",
        },
        { ...US, name: "Mei Tan" },
      ),
    ).toEqual(["Mei Tan", "10 Anson Road #20-05", "SINGAPORE 079903"]);
  });

  it("adds SINGAPORE as the country line when the postcode is missing", () => {
    expect(
      envelopeLines({ ...blank, addressLine1: "10 Anson Road", countryCode: "SG" }, US),
    ).toEqual(["10 Anson Road", "SINGAPORE"]);
  });

  it("formats Greece, Spain, Germany and South Africa", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "Ermou 15",
          city: "Athens",
          postalCode: "105 63",
          countryCode: "GR",
        },
        US,
      ),
    ).toEqual(["Ermou 15", "105 63 Athens", "GREECE"]);
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "Calle Mayor 5",
          city: "Madrid",
          stateRegion: "Madrid",
          postalCode: "28013",
          countryCode: "ES",
        },
        US,
      ),
    ).toEqual(["Calle Mayor 5", "28013 MADRID", "SPAIN"]);
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "Unter den Linden 77",
          city: "Berlin",
          postalCode: "10117",
          countryCode: "DE",
        },
        US,
      ),
    ).toEqual(["Unter den Linden 77", "10117 Berlin", "GERMANY"]);
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "12 Long Street",
          district: "Gardens",
          city: "Cape Town",
          postalCode: "8001",
          countryCode: "ZA",
        },
        US,
      ),
    ).toEqual(["12 Long Street", "Gardens", "Cape Town", "8001", "SOUTH AFRICA"]);
  });

  it("omits the country line for the sender's own country", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "Keizersgracht 212",
          city: "Amsterdam",
          postalCode: "1016 DZ",
          countryCode: "NL",
        },
        { senderCountry: "NL" },
      ),
    ).toEqual(["Keizersgracht 212", "1016 DZ Amsterdam"]);
  });

  it("drops separators next to an empty field", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "1 Main St",
          stateRegion: "OR",
          postalCode: "97214",
          countryCode: "US",
        },
        US,
      ),
    ).toEqual(["1 Main St", "OR 97214"]);
    expect(
      envelopeLines(
        { ...blank, addressLine1: "1 Main St", city: "Portland", countryCode: "US" },
        US,
      ),
    ).toEqual(["1 Main St", "PORTLAND"]);
  });

  it("formats a blank country as the sender's country", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "1 Main St",
          city: "Portland",
          stateRegion: "OR",
          postalCode: "97214",
        },
        US,
      ),
    ).toEqual(["1 Main St", "PORTLAND, OR 97214"]);
  });

  it("prints unrecognized country text as typed, in the old order", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          addressLine1: "1 Coral Way",
          city: "Port Royal",
          postalCode: "X1",
          legacyCountry: "Atlantis",
        },
        US,
      ),
    ).toEqual(["1 Coral Way", "Port Royal, X1", "ATLANTIS"]);
  });

  it("is null without a street line", () => {
    expect(envelopeLines(blank, US)).toBeNull();
    expect(
      envelopeLines({ ...blank, city: "Oslo", addressLine2: "Apt 3", countryCode: "NO" }, US),
    ).toBeNull();
  });

  it("writes Japanese with the 〒 mark and 様", () => {
    expect(
      envelopeLines(
        {
          ...blank,
          postalCode: "100-0005",
          stateRegion: "東京都",
          addressLine1: "千代田区丸の内1-1-1",
          countryCode: "JP",
        },
        { ...US, name: "山田太郎" },
      ),
    ).toEqual(["〒100-0005", "東京都", "千代田区丸の内1-1-1", "山田太郎 様", "JAPAN"]);
  });
});
