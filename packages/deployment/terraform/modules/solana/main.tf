# Solana RPC Node Infrastructure for Jeju Network
# Provides dedicated Solana RPC endpoints for cross-chain token operations

variable "environment" {
  description = "Environment name (testnet/mainnet)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for networking"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for node placement"
  type        = list(string)
}

variable "solana_network" {
  description = "Solana network (mainnet-beta, devnet, testnet)"
  type        = string
  default     = "devnet"
}

variable "node_count" {
  description = "Number of Solana RPC nodes"
  type        = number
  default     = 2
}

variable "instance_type" {
  description = "EC2 instance type for Solana nodes"
  type        = string
  default     = "r6i.2xlarge" # Solana needs significant resources
}

variable "disk_size_gb" {
  description = "Disk size for ledger storage"
  type        = number
  default     = 2000 # Solana ledger is large
}

variable "key_name" {
  description = "SSH key pair name"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags for resources"
  type        = map(string)
  default     = {}
}

# Get latest Ubuntu AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Security group for Solana nodes
resource "aws_security_group" "solana" {
  name        = "jeju-${var.environment}-solana-sg"
  description = "Security group for Solana RPC nodes"
  vpc_id      = var.vpc_id

  # RPC
  ingress {
    from_port   = 8899
    to_port     = 8899
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Solana RPC"
  }

  # WebSocket
  ingress {
    from_port   = 8900
    to_port     = 8900
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Solana WebSocket"
  }

  # Gossip
  ingress {
    from_port   = 8000
    to_port     = 8020
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Solana Gossip TCP"
  }

  ingress {
    from_port   = 8000
    to_port     = 8020
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Solana Gossip UDP"
  }

  # TPU
  ingress {
    from_port   = 8001
    to_port     = 8020
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Solana TPU"
  }

  # SSH
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "SSH from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound"
  }

  tags = merge(var.tags, {
    Name = "jeju-${var.environment}-solana-sg"
  })
}

# IAM role for Solana nodes
resource "aws_iam_role" "solana" {
  name = "jeju-${var.environment}-solana-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "solana_ssm" {
  role       = aws_iam_role.solana.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "solana" {
  name = "jeju-${var.environment}-solana-profile"
  role = aws_iam_role.solana.name
}

# Launch template for Solana nodes
resource "aws_launch_template" "solana" {
  name_prefix   = "jeju-${var.environment}-solana-"
  image_id      = data.aws_ami.ubuntu.id
  instance_type = var.instance_type

  iam_instance_profile {
    name = aws_iam_instance_profile.solana.name
  }

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.solana.id]
  }

  block_device_mappings {
    device_name = "/dev/sda1"
    ebs {
      volume_size           = 100
      volume_type           = "gp3"
      delete_on_termination = true
    }
  }

  # Ledger storage
  block_device_mappings {
    device_name = "/dev/sdf"
    ebs {
      volume_size           = var.disk_size_gb
      volume_type           = "gp3"
      iops                  = 3000
      throughput            = 500
      delete_on_termination = false
    }
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e

    # Update system
    apt-get update
    apt-get upgrade -y

    # Install dependencies
    apt-get install -y curl wget jq

    # Mount ledger disk
    mkfs.ext4 /dev/nvme1n1 || true
    mkdir -p /mnt/solana-ledger
    mount /dev/nvme1n1 /mnt/solana-ledger
    echo '/dev/nvme1n1 /mnt/solana-ledger ext4 defaults 0 2' >> /etc/fstab

    # Create solana user
    useradd -m -s /bin/bash solana
    chown solana:solana /mnt/solana-ledger

    # Install Solana CLI
    su - solana -c 'sh -c "$(curl -sSfL https://release.solana.com/stable/install)"'

    # Create systemd service
    cat > /etc/systemd/system/solana.service <<'SOLANA_SERVICE'
    [Unit]
    Description=Solana RPC Node
    After=network.target

    [Service]
    Type=simple
    User=solana
    WorkingDirectory=/home/solana
    Environment="PATH=/home/solana/.local/share/solana/install/active_release/bin:/usr/bin"
    ExecStart=/home/solana/.local/share/solana/install/active_release/bin/solana-validator \
      --identity /home/solana/validator-keypair.json \
      --vote-account /home/solana/vote-account-keypair.json \
      --known-validator dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92 \
      --known-validator dv2eQHeP4RFrJZ6UeiZWoc3XTtmtZCUKxxCApCDcRNV \
      --only-known-rpc \
      --ledger /mnt/solana-ledger \
      --rpc-port 8899 \
      --dynamic-port-range 8000-8020 \
      --entrypoint entrypoint.${var.solana_network}.solana.com:8001 \
      --expected-genesis-hash ${var.solana_network == "mainnet-beta" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : var.solana_network == "devnet" ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" : "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"} \
      --wal-recovery-mode skip_any_corrupted_record \
      --no-wait-for-vote-to-start-leader \
      --enable-rpc-transaction-history \
      --enable-cpi-and-log-storage \
      --rpc-bind-address 0.0.0.0 \
      --limit-ledger-size
    Restart=on-failure
    RestartSec=10

    [Install]
    WantedBy=multi-user.target
    SOLANA_SERVICE

    # Generate keypairs if they don't exist
    su - solana -c '/home/solana/.local/share/solana/install/active_release/bin/solana-keygen new -o /home/solana/validator-keypair.json --no-passphrase || true'
    su - solana -c '/home/solana/.local/share/solana/install/active_release/bin/solana-keygen new -o /home/solana/vote-account-keypair.json --no-passphrase || true'

    # Configure Solana CLI
    su - solana -c '/home/solana/.local/share/solana/install/active_release/bin/solana config set --url https://api.${var.solana_network}.solana.com'

    # Start service
    systemctl daemon-reload
    systemctl enable solana
    systemctl start solana
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = merge(var.tags, {
      Name = "jeju-${var.environment}-solana"
    })
  }

  tag_specifications {
    resource_type = "volume"
    tags = merge(var.tags, {
      Name = "jeju-${var.environment}-solana-volume"
    })
  }
}

# Auto Scaling Group
resource "aws_autoscaling_group" "solana" {
  name                = "jeju-${var.environment}-solana-asg"
  vpc_zone_identifier = var.subnet_ids
  min_size            = var.node_count
  max_size            = var.node_count
  desired_capacity    = var.node_count

  launch_template {
    id      = aws_launch_template.solana.id
    version = "$Latest"
  }

  health_check_type         = "EC2"
  health_check_grace_period = 300

  tag {
    key                 = "Name"
    value               = "jeju-${var.environment}-solana"
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = var.tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

# Network Load Balancer for Solana RPC
resource "aws_lb" "solana_rpc" {
  name               = "jeju-${var.environment}-solana-rpc"
  internal           = false
  load_balancer_type = "network"
  subnets            = var.subnet_ids

  enable_cross_zone_load_balancing = true

  tags = merge(var.tags, {
    Name = "jeju-${var.environment}-solana-rpc"
  })
}

resource "aws_lb_target_group" "solana_rpc" {
  name     = "jeju-${var.environment}-sol-rpc"
  port     = 8899
  protocol = "TCP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    interval            = 30
    port                = "traffic-port"
    protocol            = "TCP"
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_target_group" "solana_ws" {
  name     = "jeju-${var.environment}-sol-ws"
  port     = 8900
  protocol = "TCP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    interval            = 30
    port                = 8899 # Use RPC port for health
    protocol            = "TCP"
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_listener" "solana_rpc" {
  load_balancer_arn = aws_lb.solana_rpc.arn
  port              = 443
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.solana_rpc.arn
  }
}

resource "aws_lb_listener" "solana_ws" {
  load_balancer_arn = aws_lb.solana_rpc.arn
  port              = 444
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.solana_ws.arn
  }
}

resource "aws_autoscaling_attachment" "solana_rpc" {
  autoscaling_group_name = aws_autoscaling_group.solana.name
  lb_target_group_arn    = aws_lb_target_group.solana_rpc.arn
}

resource "aws_autoscaling_attachment" "solana_ws" {
  autoscaling_group_name = aws_autoscaling_group.solana.name
  lb_target_group_arn    = aws_lb_target_group.solana_ws.arn
}

# Outputs
output "rpc_endpoint" {
  description = "Solana RPC endpoint"
  value       = "https://${aws_lb.solana_rpc.dns_name}"
}

output "ws_endpoint" {
  description = "Solana WebSocket endpoint"
  value       = "wss://${aws_lb.solana_rpc.dns_name}:444"
}

output "security_group_id" {
  description = "Security group ID for Solana nodes"
  value       = aws_security_group.solana.id
}

output "asg_name" {
  description = "Auto Scaling Group name"
  value       = aws_autoscaling_group.solana.name
}
