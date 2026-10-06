import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req, context) => {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Verification failed', { status: 403 });
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messageObj = value?.messages?.[0];

      if (!messageObj) return new Response('OK', { status: 200 });

      const senderPhone = messageObj.from;
      const customerMessage = messageObj.text?.body;
      const customerName = value?.contacts?.[0]?.profile?.name || 'Customer';

      if (!customerMessage) return new Response('OK', { status: 200 });

      // Fetch or Create Lead
      let { data: lead } = await supabase
        .from('leads')
        .select('*')
        .eq('whatsapp_number', senderPhone)
        .single();

      if (!lead) {
        const { data: newLead } = await supabase
          .from('leads')
          .insert([{
            whatsapp_number: senderPhone,
            customer_name: customerName,
            last_message: customerMessage,
            lead_status: 'COLD',
            conversation_summary: `Customer: ${customerMessage}\n`
          }])
          .select()
          .single();
        lead = newLead;
      }

      // Gemini AI Response
      const aiResponseText = await getGeminiAIResponse(lead, customerMessage);
      const updatedSummary = (lead.conversation_summary || '') + `Customer: \({customerMessage}\nBot:\){aiResponseText}\n`;
      const newStatus = evaluateLeadStatus(updatedSummary, customerMessage);

      await supabase
        .from('leads')
        .update({
          last_message: customerMessage,
          conversation_summary: updatedSummary,
          lead_status: newStatus,
          updated_at: new Date()
        })
        .eq('whatsapp_number', senderPhone);

      // Notify Salesperson if HOT
      if (newStatus === 'HOT' && lead.lead_status !== 'HOT') {
        await notifySalesperson(lead, updatedSummary);
      }

      await sendWhatsAppMessage(senderPhone, aiResponseText);
      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error(err);
      return new Response('Error', { status: 500 });
    }
  }
  return new Response('Method not allowed', { status: 405 });
};

async function getGeminiAIResponse(lead, userMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  const prompt = `You are a professional human sales executive for "EduBoardX Solution". We sell digital interactive flat panels, studio cameras, microphones, and hybrid classroom setups.
  
  Instructions:
  - Speak naturally in Hindi, Hinglish, or English matching the customer's language style. Keep it conversational and warm, like a real human sales expert.
  - Ask 1-2 relevant questions at a time. Do not interrogate.
  - Understand requirements like name, city, coaching/school type, student count, screen size (e.g. 75-inch), budget, camera, microphone, and purchase timeline.
  - Never invent prices, specs, or warranty info.
  
  Chat History:
  ${lead.conversation_summary || ''}
  
  Customer says: "${userMessage}"
  
  Reply naturally:`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Bilkul sir, main samajh gaya. Aapko isme aur kya janna hai?";
  } catch (e) {
    return "Bilkul sir, batayein aapko aur kya details chahiye?";
  }
}

function evaluateLeadStatus(summary, latestMessage) {
  const lower = (summary + ' ' + latestMessage).toLowerCase();
  if (lower.includes('isi month') || lower.includes('jaldi') || lower.includes('final') || lower.includes('demo') || lower.includes('kharidna') || lower.includes('price batao') || lower.includes('visit')) {
    return 'HOT';
  } else if (lower.includes('soch raha') || lower.includes('baad mein') || lower.includes('price kya hai')) {
    return 'WARM';
  }
  return 'COLD';
}

async function sendWhatsAppMessage(toPhone, textMessage) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: toPhone, type: 'text', text: { body: textMessage } })
  });
}

async function notifySalesperson(lead, summary) {
  const salesPhone = process.env.SALES_PERSON_WHATSAPP;
  if (!salesPhone) return;
  const alertText = `🔥 HOT LEAD ALERT!\n\nName: \({lead.customer_name}\nWhatsApp:\){lead.whatsapp_number}\n\nSummary:\n${summary}`;
  await sendWhatsAppMessage(salesPhone, alertText);
}