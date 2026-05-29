import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function POST(req: NextRequest) {
  const { lead } = await req.json()
  if (!lead) return NextResponse.json({ error: 'Missing lead data' }, { status: 400 })

  const painPoints: string[] = []

  // Website pain points
  if (!lead.website_url || lead.website_status === 'No website') {
    painPoints.push('no website presence at all — missing out on online customers every day')
  } else if (lead.website_status === 'Outdated / Needs redesign') {
    painPoints.push('an outdated website that likely hurts credibility and conversion rates')
  } else if (lead.website_status === 'Under construction') {
    painPoints.push('a website still under construction — losing potential customers who visit and leave')
  }

  // GMB pain points
  if (lead.gmb_review_rating) {
    if (lead.gmb_review_rating < 4.0) {
      painPoints.push(`a Google rating of only ${lead.gmb_review_rating} stars which pushes customers toward competitors`)
    } else if (lead.gmb_review_rating < 4.5) {
      painPoints.push(`a Google rating of ${lead.gmb_review_rating} stars — room to improve and outrank local competitors`)
    }
    if (lead.number_of_reviews && lead.number_of_reviews < 50) {
      painPoints.push(`only ${lead.number_of_reviews} Google reviews — new customers hesitate without strong social proof`)
    }
  } else {
    painPoints.push('an unclaimed or incomplete Google Business Profile — invisible on local search')
  }

  // Competitor pain points
  if (lead.competitor_count && lead.competitor_count >= 5) {
    painPoints.push(`${lead.competitor_count} competitors in your area fighting for the same customers online`)
  }

  const prompt = `You are a professional digital marketing outreach specialist at Novelio Technologies. Write a short, personalized cold outreach email to a business owner.

Business details:
- Business name: ${lead.company_name}
- Contact name: ${lead.name || 'Business Owner'}
- Business type: ${lead.business_type || lead.gmb_category || 'local business'}
- City: ${lead.city || ''}
- Our WhatsApp contact: ${process.env.AGENT_WHATSAPP || ''}
- Website: ${lead.website_url || 'None'}
- Website status: ${lead.website_status || 'Unknown'}
- GMB rating: ${lead.gmb_review_rating || 'Not found'} ${lead.number_of_reviews ? `(${lead.number_of_reviews} reviews)` : ''}
- Competitors nearby: ${lead.competitor_count || 'Unknown'}

Identified pain points:
${painPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Write a cold email that:
1. Opens with a specific observation about their business (mention the pain point naturally, not aggressively)
2. Briefly explains the impact (lost customers, revenue, visibility)
3. Introduces Novelio Technologies as the solution (we help local businesses grow online through website design, GMB optimization, SEO, and Google Ads)
4. Ends with a soft CTA — ask for a 15-minute call to share ideas, no pressure${process.env.AGENT_WHATSAPP ? `. Mention they can reply via WhatsApp at ${process.env.AGENT_WHATSAPP} if easier` : ''}
5. Keep it under 180 words — concise and conversational, not salesy
6. Use plain text, no markdown, no bullet points in the email body
7. Sign off as "The Novelio Team"

Output only the email body — no subject line, no extra explanation.`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = (message.content[0] as any).text?.trim() || ''
    return NextResponse.json({ email: text })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Generation failed' }, { status: 500 })
  }
}
