# 🚂 Railway Deployment Guide

## 📧 **Email Countdown System Features:**
- 🎯 **7-day countdown** - customers get daily reminders
- 📅 **Automatic emails** at 10 AM every day
- 🎨 **Beautiful HTML emails** with countdown styling
- 📱 **Mobile-friendly** email templates
- 🧹 **Auto cleanup** of old orders

## 🚀 **Step-by-Step Railway Deployment:**

### **Step 1: Prepare Your Environment Variables**
Set these in Railway dashboard:

```env
# Stripe Keys
STRIPE_PUBLISHABLE_KEY=pk_test_your_actual_key
STRIPE_SECRET_KEY=sk_test_your_actual_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Server Config
NODE_ENV=production
PORT=3000

# Email Config (REQUIRED for countdown emails)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_business_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_FROM="LUXE WIGS <your_business_email@gmail.com>"
```

### **Step 2: Deploy to Railway**
1. Go to https://railway.app
2. Connect your GitHub account
3. Create new project from GitHub repo
4. Select your wig-ecom-store repository
5. Railway will auto-detect the backend folder

### **Step 3: Configure Environment Variables**
1. In Railway dashboard → Settings → Variables
2. Add all the environment variables above
3. Replace placeholder values with your actual keys

### **Step 4: Set up Gmail App Password**
1. Enable 2FA on your Gmail account
2. Go to Google Account Settings → Security → 2-Step Verification
3. Generate an "App Password" for "Mail"
4. Use this password (not your regular Gmail password) for EMAIL_PASS

### **Step 5: Test Your Deployment**
1. Railway will give you a live URL (like: https://your-app.railway.app)
2. Test a purchase with Stripe test cards
3. Check that confirmation emails are sent
4. Countdown emails will start the next day at 10 AM

## 📧 **Email Countdown Timeline:**
- **Day 0**: Order confirmation email
- **Day 1**: "6 days left" countdown email 🚛
- **Day 2**: "5 days left" countdown email 📦  
- **Day 3**: "4 days left" countdown email ⏰
- **Day 4**: "3 days left" countdown email ✨
- **Day 5**: "2 days left" countdown email 🎉
- **Day 6**: "1 day left" countdown email 🎊
- **Day 7**: "Delivery day!" email 🎁

## 🔧 **Troubleshooting:**
- **No emails sent**: Check EMAIL_USER and EMAIL_PASS in Railway
- **Stripe errors**: Verify your secret key is correct
- **App crashes**: Check Railway logs for detailed errors
