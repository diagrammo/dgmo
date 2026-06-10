// Five non-trivial boxes-and-lines examples for the router playground.
// Each stresses the router differently: nesting, cycles, fan-out/in, labels, tags.
// Verified against the current parser (clean parse, no diagnostics).
export const PRESETS: Record<string, string> = {
  'E-Commerce (tags + nested + cycle)': `boxes-and-lines E-Commerce Platform

tag Team as t Backend blue, Frontend green, Platform purple
tag Priority as p High red, Medium orange, Low gray

active-tag Team
hide priority:Low

box-metric Load orange

direction LR

API Gateway t: Backend, value: 850
  Main entry point for all requests
  Routes to **backend services**
  -routes-> UserService
  -routes-> ProductService
  -routes-> OrderService

UserService t: Backend, value: 430
  Handles auth and profiles
  -reads-> UserDB
  -checks-> SessionCache

ProductService t: Frontend, value: 620, description: Product catalog and search
  -queries-> ProductDB
  -invalidates-> ProductCache

OrderService t: Backend, value: 290
  Order processing pipeline
  -writes-> OrderDB
  -publishes-> OrderQueue

UserDB t: Platform
ProductDB t: Platform
OrderDB t: Platform
SessionCache t: Platform
ProductCache t: Platform
OrderQueue t: Platform

PaymentGateway t: Backend, description: Stripe integration

WebApp t: Frontend
  -> API Gateway

Admin t: Backend
  -> API Gateway

[AWS us-east-1]
  [Compute]
    API Gateway
    UserService
    ProductService
    OrderService
  [Data]
    UserDB
    ProductDB
    OrderDB

OrderService -charges-> PaymentGateway
OrderQueue -> PaymentGateway
SessionCache <-syncs-> ProductCache p: Medium`,

  'Microservices mesh (cycles + fan-out)': `boxes-and-lines Order Fulfillment Mesh
direction LR
Gateway -routes-> OrderSvc
Gateway -routes-> CatalogSvc
OrderSvc -reserves-> InventorySvc
OrderSvc -charges-> PaymentSvc
PaymentSvc -confirms-> OrderSvc
InventorySvc -lowstock-> ReplenishSvc
ReplenishSvc -restocks-> InventorySvc
OrderSvc -emits-> EventBus
EventBus -notifies-> ShippingSvc
ShippingSvc -tracks-> OrderSvc
EventBus -notifies-> EmailSvc
CatalogSvc -reads-> InventorySvc`,

  'Cloud VPC (deep nesting)': `boxes-and-lines Production VPC
direction TB
ALB -> WebTier
WebTier -> AppTier
AppTier -> Primary
AppTier -> Replica
AppTier -> Redis
Primary -replicates-> Replica
AppTier -enqueues-> Queue
Queue -> Worker
Worker -writes-> Primary
[AWS us-east-1]
  [Public Subnet]
    ALB
    WebTier
  [Private Subnet]
    AppTier
    Worker
    Queue
  [Data Subnet]
    Primary
    Replica
    Redis`,

  'Analytics pipeline (fan-in/out DAG)': `boxes-and-lines Analytics Pipeline
direction LR
Web -> Collector
Mobile -> Collector
Partners -> Collector
Collector -> Kafka
Kafka -> StreamProc
Kafka -> BatchProc
StreamProc -> Warehouse
BatchProc -> Warehouse
StreamProc -> RealtimeDB
Warehouse -> BI
Warehouse -> MLTraining
RealtimeDB -> Dashboard
MLTraining -> ModelStore
ModelStore -feeds-> StreamProc`,

  'Delivery pipeline (tags + descriptions)': `boxes-and-lines Delivery Pipeline

tag Stage as s Source blue, Build orange, Deploy green

direction LR

Commit s: Source
  Developer pushes to main branch
  -triggers-> CI

CI s: Build
  Runs tests and linters
  -builds-> Image
  -reports-> Slack

Image s: Build
  -scans-> Security
  -pushes-> Registry

Security s: Build
  Static analysis and CVE scan
  -blocks-> CI

Registry s: Deploy
  -deploys-> Staging

Staging s: Deploy
  -promotes-> Prod
  -notifies-> Slack

Prod s: Deploy
  -alerts-> Slack
  -rollback-> Staging

Slack s: Source`,

  'STRESS: large service graph': `boxes-and-lines Platform
direction LR
Edge -> Gateway
Gateway -> Auth
Gateway -> Catalog
Gateway -> Cart
Gateway -> Search
Cart -> Orders
Orders -> Payments
Orders -> Inventory
Payments -> Ledger
Payments -> Fraud
Fraud -> Orders
Inventory -> Warehouse
Inventory -> Suppliers
Catalog -> Search
Search -> Recommendations
Recommendations -> Catalog
Orders -> Notifications
Notifications -> Email
Notifications -> SMS
Auth -> Sessions
Sessions -> Cache
Orders -> EventBus
EventBus -> Analytics
EventBus -> Notifications
Analytics -> Warehouse`,

  'STRESS: multi-region (deep nesting)': `boxes-and-lines Multi-Region
direction TB
DNS -> LB1
DNS -> LB2
LB1 -> Web1
LB1 -> Web2
Web1 -> App1
Web2 -> App1
App1 -> DB1
App1 -> Cache1
App1 -> Queue1
Queue1 -> Worker1
Worker1 -> DB1
LB2 -> Web3
Web3 -> App2
App2 -> DB2
App2 -> Cache2
DB1 -replicates-> DB2
[Region East]
  [Tier Web E]
    Web1
    Web2
  [Tier App E]
    App1
    Worker1
    Queue1
  [Tier Data E]
    DB1
    Cache1
[Region West]
  [Tier Web W]
    Web3
  [Tier App W]
    App2
  [Tier Data W]
    DB2
    Cache2`,
};
