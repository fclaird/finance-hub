import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";

import { getPlaidClient } from "@/lib/plaid/client";

export async function POST() {
  const client = getPlaidClient();
  const resp = await client.linkTokenCreate({
    user: { client_user_id: "local-user" },
    client_name: "Finance Hub",
    products: [Products.Investments],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return NextResponse.json({ ok: true, link_token: resp.data.link_token });
}

