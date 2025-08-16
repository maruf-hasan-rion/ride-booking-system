# 🚖 Ride Booking System Backend

A secure, scalable, and role-based backend API for a **Ride Booking Platform** (like Uber, Pathao) built with **Node.js**, **Express**, and **MongoDB**.

Supports multiple user roles (**Rider**, **Driver**, **Admin**) with JWT authentication and role-based access control.

---

## 📖 Overview

### Key Features

- **Riders**

  - Request a ride with pickup & destination
  - Cancel a ride within allowed window
  - View ride history

- **Drivers**

  - Accept or reject ride requests
  - Update ride status (`picked_up` → `in_transit` → `completed`)
  - View earnings history
  - Online/offline availability

- **Admins**

  - View all users, drivers, and rides
  - Approve or suspend drivers
  - Block or unblock users
  - View system statistics

- **System**
  - Role-based authorization
  - Complete ride history stored
  - Automatic fare calculation

---

## ⚙️ Setup & Installation

### 1. Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [MongoDB](https://www.mongodb.com/) (local or cloud)
- [Postman](https://www.postman.com/) (for API testing)

---

### 2. Clone the Repository

```bash
git clone https://github.com/maruf-hasan-rion/ride-booking-system.git
cd ride-booking-system
```

---

### 3. Install Dependencies

```bash
npm install
```

---

### 4. Configure Environment Variables

Create a `.env` file in the project root and add:

```env
PORT=
DB_URL=
NODE_ENV=

# JWT
JWT_ACCESS_SECRET=
JWT_ACCESS_EXPIRES=
JWT_REFRESH_SECRET=
JWT_REFRESH_EXPIRES=

# BCRYPT
BCRYPT_SALT_ROUND=

# SUPER ADMIN
SUPER_ADMIN_EMAIL=
SUPER_ADMIN_PASSWORD=

# Google
GOOGLE_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CALLBACK_URL=

# Express Session
EXPRESS_SESSION_SECRET=

# Frontend URL
FRONTEND_URL=http://localhost:5173
```

---

### 5. Start the Development Server

```bash
npm run dev
```

Server runs at:

```
http://localhost:5000
```

---

## 📌 API Endpoints Summary

### 🔹 Auth (`/api/v1/auth`)

| Method | Endpoint | Description | Auth Required |
| ------ | -------- | ----------- | ------------- |
| POST   | `/login` | Login user  | ❌            |

---

### 🔹 ride (`/api/v1/ride`)

| Method | Endpoint      | Description       | Role  |
| ------ | ------------- | ----------------- | ----- |
| POST   | `/request`    | Request a ride    | Rider |
| PATCH  | `/:id/cancel` | Cancel ride       | Rider |
| GET    | `/me`         | View ride history | Rider |
| GET    | `/`           | List all rides    | Admin |

---

### 🔹 User (default:Rider) (`/api/v1/user`)

| Method | Endpoint       | Description       | Role  |
| ------ | -------------- | ----------------- | ----- |
| POST   | `/register`    | Register new user | Any   |
| GET    | `/`            | List all users    | Admin |
| PATCH  | `/block/:id`   | Block user        | Admin |
| PATCH  | `/unblock/:id` | Unblock user      | Admin |

---

### 🔹 Driver (`/api/v1/driver`)

| Method | Endpoint       | Description           | Role   |
| ------ | -------------- | --------------------- | ------ |
| POST   | `/profile`     | Create driver profile | Driver |
| PATCH  | `/status`      | Update availability   | Driver |
| PATCH  | `/:id/accept`  | Accept ride request   | Driver |
| PATCH  | `/:id/reject`  | Reject ride request   | Driver |
| PATCH  | `/:id/status`  | Update ride status    | Driver |
| GET    | `/earnings/me` | View earnings history | Driver |
| GET    | `/`            | List all drivers      | Admin  |
| PATCH  | `/approve/:id` | Approve driver        | Admin  |
| PATCH  | `/suspend/:id` | Suspend driver        | Admin  |

---

### 🔹 Admin (`/api/v1/admin`)

| Method | Endpoint | Description       | Role  |
| ------ | -------- | ----------------- | ----- |
| GET    | `/stats` | View system stats | Admin |

---

## 📂 Project Structure

```
src/
  app/
    modules/
      user/
      driver/
      ride/
      admin/
      auth/
    middlewares/
    utils/
  app.ts
  server.ts
```

---

## 🧪 Testing with Postman

1. Import the provided Postman collection
2. Follow ride lifecycle:
   - Rider requests ride
   - Driver accepts & completes ride
   - Earnings and history available

---

## Author

**Maruf Hasan Rion** – [.vercel.app](https://ride-booking-system-kappa.vercel.app)
