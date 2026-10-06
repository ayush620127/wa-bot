const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
    );

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", {
        ascending: false
      });

    if (error) {
      console.error("Supabase Error:", error);

      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Unable to fetch leads"
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(data || [])
    };

  } catch (error) {

    console.error("Server Error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: "Server error"
      })
    };
  }
};