mkdir -p /stitch

wget -O /stitch/stitch_agent https://stitch-agent.s3.amazonaws.com/stitch_agent
chmod +x /stitch/stitch_agent


nohup /stitch/stitch_agent &